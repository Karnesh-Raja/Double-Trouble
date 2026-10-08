import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRisk } from '../src/engines/riskEngine.js';
import { MODEL_CONFIG } from '../src/engines/modelConfig.js';

test('risk levels and exact boundaries (>72 LOW, 48-72 MEDIUM, 24-48 HIGH, <24 CRITICAL)', () => {
  const cases = [[120, 'LOW'], [72.1, 'LOW'], [72, 'MEDIUM'], [60, 'MEDIUM'], [48, 'MEDIUM'], [47.9, 'HIGH'], [24, 'HIGH'], [23.9, 'CRITICAL'], [18, 'CRITICAL'], [0, 'CRITICAL']];
  for (const [h, level] of cases) assert.equal(calculateRisk(h).level, level, `${h}h`);
});

test('thresholds are configurable', () => {
  const cfg = { ...MODEL_CONFIG, risk: { lowAboveHours: 100, mediumAtOrAboveHours: 80, highAtOrAboveHours: 40 } };
  assert.equal(calculateRisk(90, cfg).level, 'MEDIUM');
  assert.equal(calculateRisk(90).level, 'LOW');
});

test('returns a human-readable reason and the thresholds used', () => {
  const r = calculateRisk(18);
  assert.match(r.reasons[0], /below 24h/);
  assert.equal(r.thresholds.highAtOrAboveHours, 24);
});

test('invalid remainingHours is rejected', () => {
  for (const bad of [-1, NaN, '5', null, undefined, Infinity]) assert.throws(() => calculateRisk(bad), (e) => e.name === 'InvalidInputError');
});
