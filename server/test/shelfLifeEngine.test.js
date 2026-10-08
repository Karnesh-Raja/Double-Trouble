import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateShelfLife, temperatureStress, humidityStress, transitStress, InvalidInputError } from '../src/engines/shelfLifeEngine.js';
import { MODEL_CONFIG } from '../src/engines/modelConfig.js';

const tomatoes = { produceType: 'Tomatoes', baselineShelfLifeHours: 120 };
const calc = (temperature, humidity, transitMinutes, shipment = tomatoes) => calculateShelfLife(shipment, { temperature, humidity, transitMinutes });

test('NORMAL (4C, 78%, 180min): full baseline, ~5 days, LOW, no stress', () => {
  const r = calc(4, 78, 180);
  assert.equal(r.remainingHours, 120);
  assert.equal(r.remainingDays, 5);
  assert.equal(r.degradationPercentage, 0);
  assert.equal(r.riskLevel, 'LOW');
  assert.deepEqual(r.contributions, { temperatureStress: 0, humidityStress: 0, transitStress: 0 });
  assert.deepEqual(r.factors, ['Within optimal cold-chain conditions']);
});

test('SPIKE DEMO (12C, 85%, 240min): produced by the formula -> 18h, CRITICAL', () => {
  const r = calc(12, 85, 240);
  assert.deepEqual(r.contributions, { temperatureStress: 5.2, humidityStress: 0.25, transitStress: 0.2 });
  assert.equal(r.degradationMultiplier, 6.65);
  assert.equal(r.remainingHours, 18);
  assert.equal(r.riskLevel, 'CRITICAL');
  assert.equal(r.degradationPercentage, 85);
  assert.deepEqual(r.factors, ['Elevated temperature exposure', 'High humidity', 'Extended transit duration']);
  assert.equal(r.formula, '120h / (1 + 5.2 temp + 0.25 humidity + 0.2 transit) = 120h / 6.65 = 18h');
  assert.ok(r.contributionSharePct.temperature > 90, 'temperature is the dominant factor');
});

test('moderate temperature: 6C -> 75h LOW; 8C (cold-chain limit) -> 54.5h MEDIUM', () => {
  assert.deepEqual([calc(6, 78, 180).remainingHours, calc(6, 78, 180).riskLevel], [75, 'LOW']);
  const r = calc(8, 78, 180);
  assert.deepEqual([r.remainingHours, r.riskLevel], [54.5, 'MEDIUM']);
  assert.deepEqual(r.factors, ['Mildly elevated temperature']);
});

test('high temperature alone: 12C, ideal humidity, normal transit -> 19.4h CRITICAL', () => {
  const r = calc(12, 78, 180);
  assert.deepEqual([r.remainingHours, r.riskLevel], [19.4, 'CRITICAL']);
});

test('sub-zero temperature adds freezing stress', () => {
  const r = calc(-4, 78, 180);
  assert.equal(r.contributions.temperatureStress, 2);
  assert.ok(r.factors.includes('Sub-zero temperature (freezing risk)'));
});

test('high humidity: 95% at 4C -> stress 1.0, 60h MEDIUM; low humidity 50% -> 48h MEDIUM (boundary)', () => {
  const hi = calc(4, 95, 180);
  assert.deepEqual([hi.contributions.humidityStress, hi.remainingHours, hi.riskLevel], [1, 60, 'MEDIUM']);
  assert.deepEqual(hi.factors, ['High humidity']);
  const lo = calc(4, 50, 180);
  assert.deepEqual([lo.remainingHours, lo.riskLevel], [48, 'MEDIUM']);
  assert.deepEqual(lo.factors, ['Low humidity']);
  assert.equal(calc(4, 70, 180).contributions.humidityStress, 0, 'band edge is free');
  assert.equal(calc(4, 80, 180).contributions.humidityStress, 0, 'band edge is free');
});

test('long transit: linear and CAPPED (24h at 4C -> 80h LOW, not destroyed)', () => {
  assert.equal(calc(4, 78, 240).remainingHours, 100);
  const r = calc(4, 78, 1440);
  assert.equal(r.contributions.transitStress, MODEL_CONFIG.transit.maxStress);
  assert.deepEqual([r.remainingHours, r.riskLevel], [80, 'LOW']);
  assert.deepEqual(r.factors, ['Extended transit duration']);
});

test('transit longer than the whole baseline life -> expired, 0h, CRITICAL', () => {
  const r = calc(4, 78, 121 * 60);
  assert.deepEqual([r.remainingHours, r.riskLevel, r.degradationPercentage], [0, 'CRITICAL', 100]);
  assert.ok(r.factors.includes('Transit time exceeded baseline shelf life'));
});

test('critical shelf life from combined moderate stresses (9C, 78%, 10h transit) -> 32.4h HIGH', () => {
  const r = calc(9, 78, 600);
  assert.deepEqual([r.remainingHours, r.riskLevel], [32.4, 'HIGH']);
});

test('DETERMINISM: same input gives byte-identical output, 1000 times', () => {
  const first = JSON.stringify(calc(12, 85, 240));
  for (let i = 0; i < 1000; i++) assert.equal(JSON.stringify(calc(12, 85, 240)), first);
});

test('monotonic: hotter / wetter / longer never increases shelf life', () => {
  let prev = Infinity;
  for (let t = 4; t <= 30; t += 1) { const h = calc(t, 78, 180).remainingHours; assert.ok(h <= prev); prev = h; }
  prev = Infinity;
  for (let m = 180; m <= 3000; m += 60) { const h = calc(4, 78, m).remainingHours; assert.ok(h <= prev); prev = h; }
});

test('shares of degradation sum to ~100% when there is stress', () => {
  const s = calc(12, 85, 240).contributionSharePct;
  assert.ok(Math.abs(s.temperature + s.humidity + s.transit - 100) < 0.2);
});

test('produce profile: unknown produce uses default; sensitive produce degrades faster', () => {
  assert.equal(calc(12, 85, 240, { produceType: 'Dragonfruit', baselineShelfLifeHours: 120 }).model.produceProfile, 'default');
  assert.equal(calc(12, 85, 240, { produceType: ' TOMATOES ', baselineShelfLifeHours: 120 }).remainingHours, 18);
  assert.ok(calc(12, 85, 240, { produceType: 'Spinach', baselineShelfLifeHours: 120 }).remainingHours < 18);
});

test('stress functions are individually testable', () => {
  assert.equal(temperatureStress(4), 0);
  assert.equal(temperatureStress(12), 5.2);
  assert.equal(temperatureStress(14), 8.2);
  assert.equal(humidityStress(78), 0);
  assert.equal(transitStress(180), 0);
});

test('config can be overridden without touching engine code', () => {
  const cfg = { ...MODEL_CONFIG, transit: { ...MODEL_CONFIG.transit, stressPerExtraHour: 1 } };
  assert.ok(calculateShelfLife(tomatoes, { temperature: 4, humidity: 78, transitMinutes: 240 }, cfg).remainingHours < 100);
});

test('INVALID telemetry is rejected with field-level details (never silently computed)', () => {
  const bad = [
    [{ temperature: NaN, humidity: 78, transitMinutes: 180 }, 'temperature'],
    [{ temperature: '12', humidity: 78, transitMinutes: 180 }, 'temperature'],
    [{ temperature: 999, humidity: 78, transitMinutes: 180 }, 'temperature'],
    [{ temperature: 4, humidity: 120, transitMinutes: 180 }, 'humidity'],
    [{ temperature: 4, humidity: -1, transitMinutes: 180 }, 'humidity'],
    [{ temperature: 4, humidity: 78, transitMinutes: -10 }, 'transitMinutes'],
    [{ temperature: 4, humidity: 78 }, 'transitMinutes'],
    [{ temperature: Infinity, humidity: 78, transitMinutes: 180 }, 'temperature'],
    [null, 'telemetry'],
  ];
  for (const [t, field] of bad) {
    assert.throws(() => calculateShelfLife(tomatoes, t), (e) => e instanceof InvalidInputError && e.details.some((d) => d.field === field), JSON.stringify(t));
  }
  assert.throws(() => calculateShelfLife({ produceType: 'x', baselineShelfLifeHours: 0 }, { temperature: 4, humidity: 78, transitMinutes: 0 }), InvalidInputError);
  assert.throws(() => calculateShelfLife(null, { temperature: 4, humidity: 78, transitMinutes: 0 }), InvalidInputError);
});
