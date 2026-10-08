# AgroSense Liquidation Logic

When a shipment is losing shelf life, the backend decides **what discount to offer retailers, at what price, and how urgently**. It does this with a small deterministic function over numbers the other engines already produced. The frontend only displays the result, and the AI only explains it. Neither one sets a price.

Code: `src/engines/liquidationConfig.js` (all numbers), `src/engines/liquidationEngine.js` (pure logic), `src/services/telemetryService.js` (pipeline), `src/services/marketplaceService.js` (API view).

```
telemetry -> shelf-life engine -> risk engine -> LIQUIDATION ENGINE
                                                       |
        [one DB transaction]  liquidations row  +  alert  +  marketplace listing (priced, linked to the row)
                                                       |
                                  AI explanation (after commit)      GET /api/marketplace
```

## 1. Pricing thresholds

Remaining shelf life decides the discount. The bands live only in `LIQUIDATION_CONFIG.bands`.

| Remaining shelf life | Band | Discount | Urgency | Label sent to the UI |
|---|---|---|---|---|
| more than 72 h | `NONE` | 0% | LOW | NORMAL |
| 48 h up to and including 72 h | `LIGHT` | 10% | MEDIUM | WATCH |
| 24 h up to, but not including, 48 h | `MODERATE` | 25% | HIGH | PRIORITY SALE |
| 12 h up to, but not including, 24 h | `STEEP` | 50% | CRITICAL | URGENT LIQUIDATION |
| below 12 h | `CLEARANCE` | 70% | CRITICAL | URGENT LIQUIDATION |

Edges are exact: 72.0 h is 10%, 72.1 h is 0%; 48.0 h is 10%, 47.9 h is 25%; 24.0 h is 25%; 12.0 h is 50%; 11.9 h is 70%. The discount never decreases as shelf life decreases, and the engine refuses to start with a configuration that breaks that rule.

**To change pricing, edit `liquidationConfig.js` only.** Nothing is hardcoded in the engine or the frontend. `validateLiquidationConfig()` rejects unordered bands, discounts that shrink, bad urgency names and a last band that does not start at 0 h.

## 2. Reasoning

- **Why bands and not a formula?** A distributor can read, defend and change a table. A continuous curve would be harder to explain to a retailer ("why 37.4% off?") and gives no stable price to quote.
- **Why these edges?** 72 / 48 / 24 are the same edges the risk engine uses (`modelConfig.risk`), so "LOW risk" means "no markdown", MEDIUM means 10%, HIGH means 25%, and CRITICAL starts at 50%. A test (`liquidation band edges stay aligned with the risk engine thresholds`) fails if someone retunes one engine and forgets the other.
- **Why split CRITICAL at 12 h?** Below 12 h there is not enough time to ship, list and sell at 50%, so the price drops again to move the stock. The urgency stays CRITICAL; only the price changes.
- **Why a risk floor (`riskFloorPct`)?** The risk thresholds are configurable independently. If they are retuned so a lot is CRITICAL while the hours say 25%, the lot still gets at least 50%. Discount = the larger of the band and the floor, and the reason text says when the floor applied.
- **Why is `urgency` an input that can only raise urgency?** The engine already derives urgency from the band and the risk level. A caller may pass a higher urgency (for example, an operator override), but it can never lower it, and it never changes the discount. This keeps urgency consistent with the risk level the AI step must also respect.
- **What does `produceType` do?** It selects an optional per-produce adjustment (`produceAdjustmentPts`). Every value ships as 0, because there is no price or salvage data to justify a different markdown per crop. The mechanism exists, is capped by `maxDiscountPct` (90), and is never applied to a lot that needs no markdown.

## 3. Engine contract

```js
calculateLiquidation({ marketPrice, remainingHours, riskLevel, produceType?, urgency? })
```

```json
{
  "originalPrice": 150,
  "discountPercentage": 50,
  "recommendedPrice": 75,
  "urgency": "CRITICAL",
  "urgencyLabel": "URGENT LIQUIDATION",
  "reason": "Remaining shelf life is below 24 hours.",
  "band": "STEEP"
}
```

Invalid input throws `InvalidInputError` (HTTP 400 through the error handler): a price that is zero, negative, non-numeric or not finite; negative or non-numeric shelf life; an unknown risk level or urgency. A bad price is never silently priced at 0.

`planLiquidation()` is the pipeline adapter. It wraps the result with quantity, the loss-avoided figures and `sellWithinHours`, and it does **not** throw for a bad price (see section 6).

## 4. Business assumptions

These are assumptions, not measurements. Each is a single value in the config.

| Assumption | Value | Where | What it affects |
|---|---|---|---|
| Without action, the whole lot is written off | n/a | definition of "potential loss" | the loss-avoided metric |
| Share of discounted stock that sells before it spoils | 80% (`sellThroughRate`) | config | estimated loss avoided |
| Unsold discounted stock spoils to zero value | n/a | metric definition | estimated loss avoided |
| Sell within half the remaining shelf life (`sellWindowFraction` 0.5), leaving the rest for delivery and shelf time | 0.5 (minimum 1 h) | config | `sellWithinHours` |
| One price per kg for the whole lot, in INR | n/a | shipment record | all prices |
| The "current market price" is the shipment's `basePricePerKg` | `DEFAULT_BASE_PRICE_PER_KG` (150) when none is given | `.env` | original price |

## 5. Estimated loss avoided

```
potentialLoss        = quantity x original price            value at risk if the lot spoils
estimatedRecovery    = quantity x recommended price         revenue if every kg sells at the markdown
estimatedLossAvoided = estimatedRecovery x sellThroughRate  expected value rescued
residualLoss         = potentialLoss - estimatedLossAvoided what is still lost (markdown given up + unsold stock)
```

`residualLoss` is literally "original potential loss minus liquidation recovery". `estimatedLossAvoided` is the recovery side of the same sum, because under the write-off assumption every rupee recovered is a rupee that would otherwise have been lost.

**Example, SHP-001** (1000 kg tomatoes, 18 h left, 150 to 75 per kg): potential loss 1,50,000; recovery if all sells 75,000; loss avoided 60,000; residual loss 90,000.

`GET /api/marketplace/summary` adds these across all active lots.

## 6. Automatic update and persistence

Every telemetry reading goes through the same pipeline. Nobody edits the marketplace by hand.

1. The shelf-life and risk engines run. If risk is above LOW, the liquidation engine prices the lot.
2. **Saved to the database** (`liquidations.plan_json`, with the telemetry id). A new row is written when the shipment enters a new risk episode, or when the discount, price or urgency changes. An identical repeat reading is not re-stored, so the history is the list of distinct price decisions (`GET /api/liquidation/:shipmentId/history`).
3. **The marketplace listing is created or re-priced** in the same transaction, and stores the id of the recommendation that priced it (`marketplace_listings.liquidation_id`). There is at most one OPEN listing per shipment, enforced by a unique index.
4. **An alert is generated** when the risk level escalates **or the discount deepens** (for example 50% to 70% inside CRITICAL). The alert states the price: `... 70% markdown (150 to 45 per kg).` Identical readings do not repeat alerts.
5. The AI explanation runs after the commit, on the same trigger as the alert (and always on the demo spike), so its text quotes the current markdown.
6. When risk returns to LOW the listing is withdrawn; the recommendation history is kept.

All of step 2 to 4 is one transaction, so a listing can never exist without its recommendation.

**Missing or invalid price on a shipment.** The API rejects a zero, negative or non-numeric `basePricePerKg` when a shipment is created. If a bad value is ever in the database anyway, telemetry, risk and the alert are still recorded (the alert says the recommendation is unavailable), but no recommendation row and no listing are created, and the pipeline reports `skipped_invalid_price`. A pricing problem must not lose a temperature reading.

**Missing shipment.** Telemetry, liquidation, history and listing lookups for an unknown shipment return 404. A malformed id returns 400.

## 7. API

| Route | Purpose |
|---|---|
| `GET /api/marketplace` | Active (OPEN) lots, least shelf life first. `?status=all` also returns withdrawn lots |
| `GET /api/marketplace/summary` | Totals, estimated loss avoided, count by urgency |
| `GET /api/marketplace/:shipmentId` | One shipment's active listing (404 `NO_LISTING` if none) |
| `GET /api/liquidation/:shipmentId` | Latest recommendation |
| `GET /api/liquidation/:shipmentId/history` | Every distinct recommendation, oldest first |

A listing (real output for the demo spike):

```json
{
  "id": 1, "shipmentId": "SHP-001", "produce": "Tomatoes", "quantity": 1000, "unit": "kg", "currency": "INR",
  "originalPrice": 150, "discount": 50, "recommendedPrice": 75,
  "remainingShelfLifeHours": 18, "risk": "CRITICAL", "urgency": "CRITICAL", "urgencyLabel": "URGENT LIQUIDATION",
  "band": "STEEP", "reason": "Remaining shelf life is below 24 hours.", "sellWithinHours": 9,
  "status": "OPEN", "retailerNotified": true, "liquidationId": 1,
  "value": { "potentialLoss": 150000, "estimatedRecovery": 75000, "estimatedLossAvoided": 60000, "residualLoss": 90000, "sellThroughRate": 0.8 },
  "display": { "title": "TOMATOES", "original": "₹150", "recommended": "₹75", "discount": "50% OFF", "timeLeft": "18 HOURS LEFT", "risk": "CRITICAL", "urgency": "URGENT LIQUIDATION", "unitLabel": "per kg" },
  "produceType": "Tomatoes", "originalPricePerKg": 150, "pricePerKg": 75, "markdownPct": 50, "remainingHours": 18
}
```

The last line holds the names from the first marketplace contract, kept so existing consumers do not break. `display` is what the card renders: TOMATOES, original ₹150, recommended ₹75, 50% OFF, 18 HOURS LEFT, CRITICAL, URGENT LIQUIDATION.

## 8. Worked examples

All use a 150 per kg lot of 1000 kg unless noted.

| Remaining | Risk | Discount | Price | Urgency | Reason |
|---|---|---|---|---|---|
| 120 h | LOW | 0% | 150 | LOW | above 72 hours; no markdown needed |
| 72.0 h | MEDIUM | 10% | 135 | MEDIUM | at or below 72 hours |
| 60 h | MEDIUM | 10% | 135 | MEDIUM | at or below 72 hours |
| 36 h | HIGH | 25% | 112.50 | HIGH | below 48 hours |
| 18 h | CRITICAL | 50% | 75 | CRITICAL | below 24 hours |
| 10.8 h | CRITICAL | 70% | 45 | CRITICAL | below 12 hours |

- **Risk floor:** 30 h with risk forced to CRITICAL gives 50%, not 25%, and the reason says `Risk level CRITICAL sets a minimum 50% markdown.`
- **Demo flow:** the 12 C / 85% / 240 min spike gives 18 h, CRITICAL, 75 per kg. A further reading at 15 C gives 10.8 h and re-prices the same listing to 45 per kg with a new alert.
- **Mangoes (SHP-002):** 500 kg at 80 per kg, 35.7 h, HIGH, 25% off, price 60. Potential loss 40,000; loss avoided 24,000.

## 9. Limitations

- **Loss avoided is a modelled estimate, not accounting.** It assumes the lot is worthless without action. A MEDIUM lot with 60 h left might well sell at full price, so the metric overstates the benefit for the milder bands. It is most defensible for CRITICAL lots.
- **The 80% sell-through is a single guess applied to every band.** In reality a 10% discount sells less than a 70% one. No demand data backs the number.
- **No demand, competitor or elasticity model.** The discount depends on shelf life only. It does not know local prices, retailer appetite, transport cost or whether a retailer can reach the lot within the sell window.
- **The original price is static.** The shipment's price is set once and not refreshed from a market feed.
- **Per-produce tuning is not shipped.** Strawberries and mangoes get the same discount at the same shelf life.
- **Margin is not considered.** A 70% markdown can sell below cost; the engine does not know the cost.
- **The estimate is per lot at the moment of the latest reading.** It does not track which retailers actually bought, so no realised recovery is recorded.
- **Retailer "notification" is a flag and an alert on the dashboard.** This build does not send email, SMS or WhatsApp.
- **Identical repeat readings are not stored as separate recommendations.** The telemetry table still records every reading with its shelf life.
