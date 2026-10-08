import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLiquidation, estimateValue, planLiquidation, validateLiquidationConfig, findBand } from '../src/engines/liquidationEngine.js';
import { LIQUIDATION_CONFIG } from '../src/engines/liquidationConfig.js';
import { MODEL_CONFIG } from '../src/engines/modelConfig.js';
import { calculateRisk } from '../src/engines/riskEngine.js';

const calc = (remainingHours, extra = {}) => calculateLiquidation({ marketPrice: 150, remainingHours, riskLevel: calculateRisk(remainingHours).level, produceType: 'Tomatoes', ...extra });
const isInvalid = (e) => e.name === 'InvalidInputError';

// ---------- the four shelf-life situations ----------

test('NORMAL shelf life (> 72h): no markdown, price unchanged, nothing to liquidate', () => {
  const r = calc(120);
  assert.equal(r.discountPercentage, 0);
  assert.equal(r.recommendedPrice, 150);
  assert.equal(r.originalPrice, 150);
  assert.equal(r.urgency, 'LOW');
  assert.equal(r.band, 'NONE');
  assert.match(r.reason, /above 72 hours/);
  assert.equal(planLiquidation({ riskLevel: 'LOW', remainingHours: 120, temperature: 4, spoilageRate: 1, quantity: 1000, basePricePerKg: 150 }).required, false);
});

test('MEDIUM urgency (48-72h): 10% off', () => {
  const r = calc(60);
  assert.equal(r.discountPercentage, 10);
  assert.equal(r.recommendedPrice, 135);
  assert.equal(r.urgency, 'MEDIUM');
  assert.equal(r.urgencyLabel, 'WATCH');
  assert.match(r.reason, /below 72 hours/);
});

test('HIGH urgency (24-48h): 25% off', () => {
  const r = calc(36);
  assert.equal(r.discountPercentage, 25);
  assert.equal(r.recommendedPrice, 112.5);
  assert.equal(r.urgency, 'HIGH');
  assert.match(r.reason, /below 48 hours/);
});

test('CRITICAL urgency (12-24h): 50% off, matches the spec example exactly', () => {
  const r = calc(18);
  assert.deepEqual({ originalPrice: r.originalPrice, discountPercentage: r.discountPercentage, recommendedPrice: r.recommendedPrice, urgency: r.urgency, reason: r.reason },
    { originalPrice: 150, discountPercentage: 50, recommendedPrice: 75, urgency: 'CRITICAL', reason: 'Remaining shelf life is below 24 hours.' });
  assert.equal(r.urgencyLabel, 'URGENT LIQUIDATION');
});

test('CRITICAL clearance (< 12h): 70% off', () => {
  const r = calc(8);
  assert.equal(r.discountPercentage, 70);
  assert.equal(r.recommendedPrice, 45);
  assert.equal(r.urgency, 'CRITICAL');
  assert.equal(r.band, 'CLEARANCE');
  assert.match(r.reason, /below 12 hours/);
});

test('exact band boundaries (>72 none, 72-48 10%, <48-24 25%, <24-12 50%, <12 70%)', () => {
  const cases = [[120, 0], [72.1, 0], [72, 10], [48, 10], [47.9, 25], [24, 25], [23.9, 50], [12, 50], [11.9, 70], [0.5, 70], [0, 70]];
  for (const [h, pct] of cases) assert.equal(calc(h).discountPercentage, pct, `${h}h`);
});

test('the discount never shrinks as shelf life shrinks', () => {
  let prev = -1;
  for (let h = 100; h >= 0; h -= 0.5) { const pct = calc(h).discountPercentage; assert.ok(pct >= prev, `${h}h`); prev = pct; }
});

test('recommended price is rounded to 2 decimals', () => {
  assert.equal(calculateLiquidation({ marketPrice: 99.99, remainingHours: 30, riskLevel: 'HIGH' }).recommendedPrice, 74.99);
});

// ---------- invalid input ----------

test('zero / negative / non-numeric price is rejected (never silently priced)', () => {
  for (const bad of [0, -1, -150, NaN, Infinity, '150', null, undefined, {}]) {
    assert.throws(() => calculateLiquidation({ marketPrice: bad, remainingHours: 18, riskLevel: 'CRITICAL' }), (e) => isInvalid(e) && e.details[0].field === 'marketPrice', String(bad));
  }
});

test('invalid shelf life, risk level and urgency are rejected', () => {
  for (const h of [-1, NaN, '18', null, undefined, Infinity]) assert.throws(() => calculateLiquidation({ marketPrice: 150, remainingHours: h, riskLevel: 'CRITICAL' }), (e) => isInvalid(e) && e.details[0].field === 'remainingHours');
  for (const l of ['SEVERE', 'critical', '', null, undefined]) assert.throws(() => calculateLiquidation({ marketPrice: 150, remainingHours: 18, riskLevel: l }), (e) => isInvalid(e) && e.details[0].field === 'riskLevel');
  assert.throws(() => calculateLiquidation({ marketPrice: 150, remainingHours: 18, riskLevel: 'CRITICAL', urgency: 'NOW' }), (e) => isInvalid(e) && e.details[0].field === 'urgency');
  assert.throws(() => calculateLiquidation(), isInvalid);
});

test('planLiquidation (pipeline adapter) does not throw on a bad price: it reports it so telemetry is still recorded', () => {
  for (const bad of [0, -5, NaN, null, undefined]) {
    const p = planLiquidation({ riskLevel: 'CRITICAL', remainingHours: 18, temperature: 12, spoilageRate: 6.65, quantity: 1000, basePricePerKg: bad });
    assert.equal(p.required, false);
    assert.equal(p.priced, false);
    assert.match(p.reason, /price is missing or invalid/);
  }
  // other bad input is still a hard error
  assert.throws(() => planLiquidation({ riskLevel: 'CRITICAL', remainingHours: -1, temperature: 12, spoilageRate: 1, quantity: 1, basePricePerKg: 150 }), isInvalid);
});

// ---------- risk, urgency and produce inputs ----------

test('risk level sets a minimum markdown when it is stricter than the hours bands', () => {
  const r = calculateLiquidation({ marketPrice: 150, remainingHours: 30, riskLevel: 'CRITICAL' }); // hours say 25%
  assert.equal(r.discountPercentage, 50);
  assert.match(r.reason, /Risk level CRITICAL sets a minimum 50% markdown/);
  assert.equal(calculateLiquidation({ marketPrice: 150, remainingHours: 80, riskLevel: 'MEDIUM' }).discountPercentage, 10);
});

test('a stricter hours band is never lowered by a milder risk level', () => {
  assert.equal(calculateLiquidation({ marketPrice: 150, remainingHours: 8, riskLevel: 'MEDIUM' }).discountPercentage, 70);
});

test('urgency input can raise the reported urgency but never lowers it or changes the discount', () => {
  const up = calc(60, { urgency: 'CRITICAL' });
  assert.equal(up.urgency, 'CRITICAL');
  assert.equal(up.discountPercentage, 10);
  assert.equal(calc(18, { urgency: 'LOW' }).urgency, 'CRITICAL');
});

test('produce type is accepted, case-insensitive, and unknown produce gets no adjustment by default', () => {
  assert.equal(calc(18, { produceType: 'SPINACH' }).discountPercentage, 50);
  assert.equal(calc(18, { produceType: 'Dragonfruit' }).discountPercentage, 50);
  assert.equal(calc(18, { produceType: undefined }).discountPercentage, 50);
});

test('per-produce adjustment is configurable, capped, and never applied to a lot that needs no markdown', () => {
  const cfg = { ...LIQUIDATION_CONFIG, produceAdjustmentPts: { default: 0, spinach: 10, tomatoes: 60 } };
  assert.equal(calculateLiquidation({ marketPrice: 100, remainingHours: 18, riskLevel: 'CRITICAL', produceType: 'Spinach' }, cfg).discountPercentage, 60);
  assert.match(calculateLiquidation({ marketPrice: 100, remainingHours: 18, riskLevel: 'CRITICAL', produceType: 'Spinach' }, cfg).reason, /Adjusted \+10 points for spinach/);
  assert.equal(calculateLiquidation({ marketPrice: 100, remainingHours: 18, riskLevel: 'CRITICAL', produceType: 'Tomatoes' }, cfg).discountPercentage, 90); // 50 + 60 capped at maxDiscountPct
  assert.equal(calculateLiquidation({ marketPrice: 100, remainingHours: 100, riskLevel: 'LOW', produceType: 'Spinach' }, cfg).discountPercentage, 0);
});

// ---------- configuration ----------

test('thresholds are configurable: a custom config changes the discount, nothing is hardcoded in the engine', () => {
  const cfg = { ...LIQUIDATION_CONFIG, bands: [
    { id: 'A', minHours: 100, inclusive: false, discountPct: 0, urgency: 'LOW' },
    { id: 'B', minHours: 0, inclusive: true, discountPct: 40, urgency: 'HIGH' },
  ], riskFloorPct: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } };
  assert.equal(calculateLiquidation({ marketPrice: 200, remainingHours: 90, riskLevel: 'LOW' }, cfg).discountPercentage, 40);
  assert.equal(calculateLiquidation({ marketPrice: 200, remainingHours: 90, riskLevel: 'LOW' }, cfg).recommendedPrice, 120);
  assert.equal(calculateLiquidation({ marketPrice: 200, remainingHours: 90, riskLevel: 'LOW' }).discountPercentage, 0); // default config: 90h is above the 72h edge
});

test('the shipped configuration matches the specified bands', () => {
  assert.deepEqual(LIQUIDATION_CONFIG.bands.map((b) => [b.minHours, b.discountPct]), [[72, 0], [48, 10], [24, 25], [12, 50], [0, 70]]);
  assert.equal(validateLiquidationConfig(), true);
});

test('liquidation band edges stay aligned with the risk engine thresholds', () => {
  const { lowAboveHours, mediumAtOrAboveHours, highAtOrAboveHours } = MODEL_CONFIG.risk;
  const edges = LIQUIDATION_CONFIG.bands.map((b) => b.minHours);
  assert.ok(edges.includes(lowAboveHours) && edges.includes(mediumAtOrAboveHours) && edges.includes(highAtOrAboveHours),
    'if you retune the risk thresholds, retune the liquidation bands (or rely on riskFloorPct) and update this test on purpose');
  assert.equal(findBand(lowAboveHours).band.discountPct, 10);       // exactly at the LOW/MEDIUM edge is MEDIUM in both engines
  assert.equal(findBand(lowAboveHours + 0.1).band.discountPct, 0);
});

test('a broken configuration is rejected', () => {
  const withBands = (bands) => ({ ...LIQUIDATION_CONFIG, bands });
  const b = (minHours, discountPct, inclusive = true, urgency = 'HIGH') => ({ id: `B${minHours}`, minHours, discountPct, inclusive, urgency });
  assert.throws(() => validateLiquidationConfig(withBands([])), /non-empty/);
  assert.throws(() => validateLiquidationConfig(withBands([b(24, 0), b(48, 10), b(0, 20)])), /lower than the band above/);
  assert.throws(() => validateLiquidationConfig(withBands([b(48, 30), b(0, 10)])), /must not drop/);
  assert.throws(() => validateLiquidationConfig(withBands([b(48, 0), b(10, 10)])), /last band must start at 0/);
  assert.throws(() => validateLiquidationConfig(withBands([b(48, 0), b(0, 150)])), /0-100/);
  assert.throws(() => validateLiquidationConfig(withBands([b(48, 0, true, 'SEVERE'), b(0, 10)])), /urgency/);
  assert.throws(() => calculateLiquidation({ marketPrice: 150, remainingHours: 10, riskLevel: 'HIGH' }, withBands([b(48, 0)])), /liquidation config/);
});

// ---------- loss avoided ----------

test('estimated loss avoided: 1000 kg, Rs150 -> Rs75, 80% sell-through', () => {
  const v = estimateValue({ quantity: 1000, originalPrice: 150, recommendedPrice: 75 });
  assert.deepEqual(v, { potentialLoss: 150000, estimatedRecovery: 75000, estimatedLossAvoided: 60000, residualLoss: 90000, sellThroughRate: 0.8 });
  assert.equal(v.potentialLoss - v.estimatedLossAvoided, v.residualLoss);
});

test('loss avoided scales with sell-through and quantity; invalid quantity or prices are rejected', () => {
  assert.equal(estimateValue({ quantity: 100, originalPrice: 100, recommendedPrice: 50, sellThroughRate: 1 }).estimatedLossAvoided, 5000);
  assert.equal(estimateValue({ quantity: 100, originalPrice: 100, recommendedPrice: 50, sellThroughRate: 0 }).estimatedLossAvoided, 0);
  for (const q of [0, -1, NaN, '5']) assert.throws(() => estimateValue({ quantity: q, originalPrice: 100, recommendedPrice: 50 }), isInvalid);
  assert.throws(() => estimateValue({ quantity: 1, originalPrice: 0, recommendedPrice: 0 }), isInvalid);
  assert.throws(() => estimateValue({ quantity: 1, originalPrice: 100, recommendedPrice: -1 }), isInvalid);
});

test('planLiquidation returns the complete plan the pipeline persists', () => {
  const p = planLiquidation({ riskLevel: 'CRITICAL', remainingHours: 18, temperature: 12, spoilageRate: 6.65, quantity: 1000, basePricePerKg: 150, produceType: 'Tomatoes' });
  assert.equal(p.required, true);
  assert.equal(p.discountPercentage, 50);
  assert.equal(p.markdownPct, 50);
  assert.equal(p.recommendedPrice, 75);
  assert.equal(p.markdownPricePerKg, 75);
  assert.equal(p.sellWithinHours, 9);
  assert.equal(p.estimatedLossAvoided, 60000);
  assert.equal(p.band, 'STEEP');
  assert.equal(p.configVersion, LIQUIDATION_CONFIG.version);
  assert.match(p.action, /Immediate/);
});
