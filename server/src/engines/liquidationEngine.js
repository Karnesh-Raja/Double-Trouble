// LIQUIDATION ENGINE (pure: no database, no clock, no network).
// Remaining shelf life -> discount band (from liquidationConfig.js) -> recommended price, urgency and reason.
// The backend decides every price. The frontend only displays what this returns.
import { LIQUIDATION_CONFIG } from './liquidationConfig.js';
import { RANK } from './riskEngine.js';

const LEVELS = Object.keys(RANK); // LOW, MEDIUM, HIGH, CRITICAL
const r2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const invalid = (field, message) => Object.assign(new Error(`${field} ${message}`), { name: 'InvalidInputError', details: [{ field, message }] });

// Fails fast on a broken configuration (unordered bands, discounts that shrink as shelf life shrinks, bad levels).
export function validateLiquidationConfig(cfg = LIQUIDATION_CONFIG) {
  const { bands } = cfg;
  const bad = (m) => { throw Object.assign(new Error(`liquidation config: ${m}`), { name: 'ConfigError' }); };
  if (!Array.isArray(bands) || !bands.length) bad('bands must be a non-empty array');
  bands.forEach((b, i) => {
    if (!isNum(b.minHours) || b.minHours < 0) bad(`band ${b.id}: minHours must be a number >= 0`);
    if (!isNum(b.discountPct) || b.discountPct < 0 || b.discountPct > 100) bad(`band ${b.id}: discountPct must be 0-100`);
    if (!LEVELS.includes(b.urgency)) bad(`band ${b.id}: urgency must be one of ${LEVELS.join(', ')}`);
    if (i > 0 && !(b.minHours < bands[i - 1].minHours)) bad(`band ${b.id}: minHours must be lower than the band above it`);
    if (i > 0 && b.discountPct < bands[i - 1].discountPct) bad(`band ${b.id}: discount must not drop as shelf life shrinks`);
  });
  const last = bands[bands.length - 1];
  if (last.minHours !== 0 || last.inclusive !== true) bad('the last band must start at 0 hours (inclusive) so every shelf life is covered');
  if (!isNum(cfg.maxDiscountPct) || cfg.maxDiscountPct < 0 || cfg.maxDiscountPct > 100) bad('maxDiscountPct must be 0-100');
  return true;
}
validateLiquidationConfig();

export function findBand(remainingHours, bands = LIQUIDATION_CONFIG.bands) {
  const i = bands.findIndex((b) => (b.inclusive ? remainingHours >= b.minHours : remainingHours > b.minHours));
  return { band: bands[i], index: i };
}

const bandReason = (bands, i) => {
  if (i === 0) return `Remaining shelf life is above ${bands[0].minHours} hours; no markdown needed.`;
  const above = bands[i - 1];
  return `Remaining shelf life is ${above.inclusive ? 'below' : 'at or below'} ${above.minHours} hours.`;
};

/**
 * calculateLiquidation({ marketPrice, remainingHours, riskLevel, produceType?, urgency? }, cfg?)
 *   marketPrice     current price per kg (> 0)
 *   remainingHours  remaining shelf life (>= 0)
 *   riskLevel       LOW | MEDIUM | HIGH | CRITICAL from the risk engine
 *   produceType     optional; only used for the (default zero) per-produce adjustment
 *   urgency         optional; can only RAISE the reported urgency, never lower it and never change the discount
 * Returns { originalPrice, discountPercentage, recommendedPrice, urgency, reason, ... }
 */
export function calculateLiquidation({ marketPrice, remainingHours, riskLevel, produceType, urgency } = {}, cfg = LIQUIDATION_CONFIG) {
  if (!isNum(marketPrice) || marketPrice <= 0) throw invalid('marketPrice', 'must be a finite number greater than 0');
  if (!isNum(remainingHours) || remainingHours < 0) throw invalid('remainingHours', 'must be a finite number >= 0');
  if (!LEVELS.includes(riskLevel)) throw invalid('riskLevel', `must be one of ${LEVELS.join(', ')}`);
  if (urgency !== undefined && urgency !== null && !LEVELS.includes(urgency)) throw invalid('urgency', `must be one of ${LEVELS.join(', ')}`);
  validateLiquidationConfig(cfg);

  const { band, index } = findBand(remainingHours, cfg.bands);
  const reasons = [bandReason(cfg.bands, index)];
  let pct = band.discountPct;

  const floor = cfg.riskFloorPct?.[riskLevel] ?? 0;
  if (floor > pct) { pct = floor; reasons.push(`Risk level ${riskLevel} sets a minimum ${floor}% markdown.`); }

  const key = typeof produceType === 'string' ? produceType.trim().toLowerCase() : '';
  const adj = pct > 0 ? (cfg.produceAdjustmentPts?.[key] ?? cfg.produceAdjustmentPts?.default ?? 0) : 0; // never discount a lot that needs no markdown
  if (adj) { pct += adj; reasons.push(`Adjusted ${adj > 0 ? '+' : ''}${adj} points for ${key || 'this produce'}.`); }
  pct = Math.min(Math.max(pct, 0), cfg.maxDiscountPct);

  const level = [band.urgency, riskLevel, urgency].filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  return {
    originalPrice: marketPrice,
    discountPercentage: pct,
    recommendedPrice: r2(marketPrice * (1 - pct / 100)),
    urgency: level,
    urgencyLabel: cfg.urgencyLabels[level],
    reason: reasons.join(' '),
    band: band.id,
    riskLevel,
    remainingHours,
  };
}

// Loss-avoided metric. Without action the lot is assumed to be written off, so:
//   potentialLoss        = quantity x original price                 (value at risk of total spoilage)
//   estimatedRecovery    = quantity x recommended price              (revenue if every kg sells)
//   estimatedLossAvoided = estimatedRecovery x sellThroughRate       (expected value rescued; unsold stock still spoils)
//   residualLoss         = potentialLoss - estimatedLossAvoided      (what is still lost: markdown given up + unsold stock)
export function estimateValue({ quantity, originalPrice, recommendedPrice, sellThroughRate = LIQUIDATION_CONFIG.sellThroughRate }) {
  if (!isNum(quantity) || quantity <= 0) throw invalid('quantity', 'must be a finite number greater than 0');
  if (!isNum(originalPrice) || originalPrice <= 0) throw invalid('originalPrice', 'must be a finite number greater than 0');
  if (!isNum(recommendedPrice) || recommendedPrice < 0) throw invalid('recommendedPrice', 'must be a finite number >= 0');
  const potentialLoss = r2(quantity * originalPrice);
  const estimatedRecovery = r2(quantity * recommendedPrice);
  const estimatedLossAvoided = r2(estimatedRecovery * sellThroughRate);
  return { potentialLoss, estimatedRecovery, estimatedLossAvoided, residualLoss: r2(potentialLoss - estimatedLossAvoided), sellThroughRate };
}

// Pipeline adapter: builds the full plan the telemetry pipeline persists. Never throws for a bad PRICE, because a
// pricing problem must not stop telemetry, alerts or risk from being recorded. It returns { required: false, priced: false }.
export function planLiquidation({ riskLevel, remainingHours, temperature, spoilageRate, quantity, basePricePerKg, produceType, urgency }, cfg = LIQUIDATION_CONFIG) {
  let rec;
  try {
    rec = calculateLiquidation({ marketPrice: basePricePerKg, remainingHours, riskLevel, produceType, urgency }, cfg);
  } catch (err) {
    if (err.name === 'InvalidInputError' && err.details?.[0]?.field === 'marketPrice') {
      return { required: false, priced: false, riskLevel, reason: 'Market price is missing or invalid, so no price recommendation can be made.' };
    }
    throw err;
  }
  const base = { priced: true, riskLevel, configVersion: cfg.version, ...rec };
  if (rec.discountPercentage === 0) return { required: false, ...base };

  const value = estimateValue({ quantity, originalPrice: rec.originalPrice, recommendedPrice: rec.recommendedPrice, sellThroughRate: cfg.sellThroughRate });
  return {
    required: true,
    ...base,
    // names used by the rest of the pipeline, the AI input and the existing API contract
    markdownPct: rec.discountPercentage,
    originalPricePerKg: rec.originalPrice,
    markdownPricePerKg: rec.recommendedPrice,
    quantity,
    ...value,
    sellWithinHours: Math.max(1, Math.floor(remainingHours * cfg.sellWindowFraction)), // leave the rest of the shelf life for delivery and sale
    action: rec.urgency === 'CRITICAL' ? 'Immediate markdown and retailer notification' : 'Schedule markdown and notify retailers',
    detail: `${remainingHours}h left at ${temperature}C (spoilage ${spoilageRate}x normal).`,
  };
}
