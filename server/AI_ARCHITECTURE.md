# AgroSense AI Architecture

AI in AgroSense is **decision support**: it explains a result the deterministic engines already calculated, recommends an action, and drafts the retailer message. It is not a chatbot and it never produces a number.

Code: `src/services/aiService.js` (orchestration) and `src/ai/` (`prompt.js`, `aiInput.js`, `aiValidator.js`, `aiFallback.js`).

## 1. Why AI is used

The engines answer *what*: 18 hours left, CRITICAL, factors X, Y, Z. A distributor still has to answer four questions that are language and judgement problems, not arithmetic:

| Question | AI output field |
|---|---|
| Why is this shipment at risk, and what caused the degradation? | `summary`, `riskExplanation` |
| What should the distributor do now? | `recommendedAction` |
| What should retailers be told? | `retailerMessage` |
| How urgent is it? | `urgency` |

A rule template can fill these in (and does, as the fallback), but it cannot weigh the factor mix, adapt the wording to the produce, route and price, or write a message a retailer will act on. That is where the model earns its place.

## 2. Why AI does not calculate shelf life

- **Determinism.** Same input must give the same shelf life, always. An LLM cannot guarantee that. `SHELF_LIFE_MODEL.md` documents a closed formula; every constant sits in `modelConfig.js`.
- **Explainability.** A judge can check `120 / 6.65 = 18` by hand. Nobody can audit a number a model "felt".
- **Safety of the pipeline.** Risk drives alerts, markdowns and marketplace listings. Those must never depend on an external API being up, fast or right.

The model receives the result as read-only input, and the output validator (section 7) rejects any reply that changes or invents a number.

```
telemetry -> shelf-life engine -> risk engine -> liquidation engine -> [DB transaction commits]
                                                                              |
                                          AI input (read-only facts) <--------+
                                                  |
                                       model call (server-side)
                                                  |
                       validate -> (retry once) -> else deterministic fallback
                                                  |
                              ai_insights + ai_calls rows -> dashboard
```

The AI step runs **after** the database commit. A slow, failed or invalid AI call can never lose telemetry, alerts or listings.

## 3. Prompt architecture

| Part | Where | Purpose |
|---|---|---|
| System prompt | `prompt.js` `SYSTEM_PROMPT` | Role ("agricultural cold-chain decision-support analyst"), hard rules, output contract |
| User message | `buildUserMessage()` | One JSON object inside `<shipment_data>` tags, labelled as data not instructions |
| Retry note | `retryNote()` | On the single retry, states exactly why the previous reply was rejected |
| Version | `PROMPT_VERSION = "v1.0"` | Stored with every insight and every AI call record |

Hard rules in the system prompt: never invent telemetry; never change a number; never contradict `riskLevel` (urgency must equal it); explain the cause using the supplied factors and their share; recommend a practical, waste-reducing action using the supplied liquidation plan exactly; short factual retailer message; JSON only.

**Versioning.** Any wording change must bump `PROMPT_VERSION`. Because each stored insight and call log carries the version, you can say which prompt produced which output, and compare behaviour across versions.

**Prompt-injection note.** `produceType`, `origin` and `destination` are user-typed. They are stripped of control characters and angle brackets, length-capped, placed inside the data block, and the prompt says to treat that block as data. Even if a model were fooled, the output validator still blocks wrong urgency and altered numbers.

## 4. Input schema (what the model sees)

Built by `buildAiInput()` from the engine results. Nothing is typed in by hand.

```json
{
  "shipmentId": "SHP-001",
  "produceType": "Tomatoes",
  "route": "Chennai to Bengaluru",
  "quantityKg": 1000,
  "temperature": 12,
  "humidity": 85,
  "transitMinutes": 240,
  "baselineShelfLifeHours": 120,
  "remainingShelfLifeHours": 18,
  "riskLevel": "CRITICAL",
  "degradationFactors": ["Elevated temperature exposure", "High humidity", "Extended transit duration"],
  "degradationMultiplier": 6.65,
  "factorContribution": { "temperaturePct": 92, "humidityPct": 4.4, "transitPct": 3.5 },
  "riskBands": { "criticalBelowHours": 24, "highBelowHours": 48, "mediumUpToHours": 72 },
  "liquidationPlan": { "markdownPct": 50, "originalPricePerKg": 150, "markdownPricePerKg": 75, "sellWithinHours": 9 }
}
```

The first block (`produceType`, `temperature`, `humidity`, `transitMinutes`, `remainingShelfLifeHours`, `riskLevel`, `degradationFactors`) is the spec input. The rest is context the engines already computed, so the recommendation and retailer message can quote real prices and windows. `liquidationPlan` is `null` when no markdown is needed.

## 5. Output schema

```json
{
  "summary": "...",             // 1 sentence, <= 240 chars
  "riskExplanation": "...",     // <= 500 chars: why at risk, what caused it
  "recommendedAction": "...",   // <= 500 chars: what the distributor does now
  "retailerMessage": "...",     // <= 360 chars: retailer-facing
  "urgency": "CRITICAL"         // LOW | MEDIUM | HIGH | CRITICAL, must equal riskLevel
}
```

Stored in `ai_insights` together with `source` (`claude` or `fallback-template`), `model`, `prompt_version`, `latency_ms`, `attempts`, `error`. Served by `GET /api/ai-insights/:shipmentId` and inside `aiInsight` on every shipment/spike response.

## 6. Fallback

`aiFallback.js` is a pure template over the same input. It is used when:

| Situation | Result |
|---|---|
| No `AI_API_KEY` | `status: skipped`, no network call |
| Timeout, network error, HTTP error | `status: failed` |
| Invalid output after the retry | `status: failed`, `failureType: invalid_output` |

The fallback quotes the engine numbers, uses the real liquidation plan, and **passes the same validator as model output** (a test enforces this at all four risk levels). The dashboard labels it "Deterministic fallback", so it is never passed off as AI. The API still returns 201 and the app never breaks.

## 7. Validation and retry

`validateAiOutput()` runs on every reply:

1. Parses as a JSON object (code fences tolerated).
2. Exactly the five string fields, non-empty, within length limits.
3. `urgency` is a valid level **and equals the deterministic `riskLevel`**.
4. **Numeric guard:** every number in the text must exist in the supplied input (tolerating rounding, thousands separators and the shipment id). A model that says "30h" when the engine said 18 is rejected.

Retry policy (one retry, never more):

| Failure | Retry? | Why |
|---|---|---|
| Invalid JSON / failed validation | yes, with the rejection reason appended | usually fixed by one correction |
| HTTP 429, 5xx, network error | yes, after 250 ms | transient |
| HTTP 400/401/403 | no | will not fix itself |
| Timeout (default 8 s per attempt) | no | avoids doubling the wait |

Worst case for a request is two attempts, then fallback.

## 8. Security

- The call happens only in `aiService.js` on the server. React never sees a key, a prompt or a provider URL; the client has no AI secrets in code, env or bundle.
- The key comes from `process.env.AI_API_KEY` (alias `ANTHROPIC_API_KEY`) through `utils/config.js`. `.env` is git-ignored; `.env.example` has an empty placeholder.
- The key is sent only in the `x-api-key` request header, never in the body or URL.
- The logger redacts any field whose name looks like `key/secret/token/authorization/password`; error strings are additionally scrubbed of the key value and truncated. Health and telemetry endpoints expose only whether a key is configured.
- Tests assert the key never appears in the request body, results or stored rows.

## 9. Logging and observability

Every AI request (including skipped and failed ones) writes one row to `ai_calls` and one structured log line:

`timestamp, shipmentId, telemetryId, model, promptVersion, status (ok/failed/skipped), failureType, success, attempts, latencyMs, error`

Per-attempt log lines (`ai.attempt`) show each try and why it failed. **Not recorded:** prompts, model replies, API keys, headers.

`GET /api/ai-telemetry?limit=20` returns aggregate stats (total, succeeded, failed, skipped, recovered-by-retry, success rate, average and max latency) plus the recent calls. The dashboard shows this under the AI card.

## 10. Demo

`POST /api/simulate/temperature-spike/SHP-001` (the dashboard button) sets 12 C / 85% / 240 min. The engine returns 18 h and CRITICAL, the liquidation engine plans a 50% markdown, and the AI step runs immediately (always, on the demo spike). The result appears in the **AI Cold-Chain Analysis** card: summary, risk explanation, recommended action, retailer message, urgency, plus source, model, prompt version and latency.

## 11. Limitations

- Wording from the model is not deterministic (the numbers and risk level are). Validation constrains it but cannot prove a sentence is wise.
- The numeric guard checks numbers, not claims: a model could still misattribute a cause in words. It sees only the supplied factors, which limits this.
- The advice is generic cold-chain reasoning. It does not know the operator's trucks, contracts or local market, and is not validated by food-safety experts.
- Each insight analyses one reading. It does not reason over the full temperature history.
- Retailer messages are drafts shown on the dashboard. This build does not send email, SMS or WhatsApp.
- The model's default is `claude-sonnet-5-5` (`AI_MODEL`). Provider latency and availability are outside our control, which is why the fallback exists.
