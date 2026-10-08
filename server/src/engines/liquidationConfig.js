// SINGLE SOURCE OF TRUTH for liquidation pricing. The frontend never holds or recomputes any of these numbers.
// Tune pricing here, nowhere else. Units: shelf life in hours, discounts in percent, prices in INR per kg.
export const LIQUIDATION_CONFIG = {
  version: '1.0.0',
  currency: 'INR',
  currencySymbol: '₹',

  // DISCOUNT BANDS by remaining shelf life, ordered from most shelf life to least.
  // A band applies when remainingHours > minHours (inclusive: false) or >= minHours (inclusive: true).
  // The 72 / 48 / 24 edges deliberately match the risk engine (modelConfig.risk), so a lot that is LOW risk
  // gets no markdown and a lot at exactly 72h is MEDIUM with 10%. A test enforces that the two stay aligned.
  bands: [
    { id: 'NONE',      minHours: 72, inclusive: false, discountPct: 0,  urgency: 'LOW' },       // > 72h
    { id: 'LIGHT',     minHours: 48, inclusive: true,  discountPct: 10, urgency: 'MEDIUM' },    // 48 - 72h
    { id: 'MODERATE',  minHours: 24, inclusive: true,  discountPct: 25, urgency: 'HIGH' },      // 24 - 48h
    { id: 'STEEP',     minHours: 12, inclusive: true,  discountPct: 50, urgency: 'CRITICAL' },  // 12 - 24h
    { id: 'CLEARANCE', minHours: 0,  inclusive: true,  discountPct: 70, urgency: 'CRITICAL' },  // < 12h
  ],

  // SAFETY FLOOR by risk level. The risk engine's thresholds are configurable independently of the bands above.
  // If someone retunes them so a lot is CRITICAL while the hours bands say 25%, the lot still gets at least this much.
  riskFloorPct: { LOW: 0, MEDIUM: 10, HIGH: 25, CRITICAL: 50 },

  // Optional per-produce adjustment in percentage points (added to the band discount, then capped).
  // All zero on purpose: there is no price or salvage data to justify a different markdown per crop.
  produceAdjustmentPts: { default: 0, tomatoes: 0, mangoes: 0, strawberries: 0, spinach: 0 },

  maxDiscountPct: 90, // hard cap after floors and adjustments

  // Display labels (the API sends these so the frontend only renders them).
  urgencyLabels: { LOW: 'NORMAL', MEDIUM: 'WATCH', HIGH: 'PRIORITY SALE', CRITICAL: 'URGENT LIQUIDATION' },

  // BUSINESS ASSUMPTIONS (see LIQUIDATION_LOGIC.md)
  sellThroughRate: 0.8,   // share of discounted stock expected to sell before it spoils; unsold stock is a total loss
  sellWindowFraction: 0.5, // sell within this share of the remaining shelf life, leaving the rest for delivery and shelf time
};
