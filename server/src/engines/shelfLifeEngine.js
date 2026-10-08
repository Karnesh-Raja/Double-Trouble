// SHELF-LIFE ENGINE: deterministic, pure, no randomness, no I/O, no LLM.
//
//   degradationMultiplier = 1 + temperatureStress + humidityStress + transitStress
//   remainingHours        = baselineShelfLifeHours / degradationMultiplier
//
// Perfect conditions => all stresses are 0 => multiplier 1 => full baseline life.
// Each stress is a simple linear sum over configured bands (see modelConfig.js). Full write-up: SHELF_LIFE_MODEL.md
import { MODEL_CONFIG } from './modelConfig.js';
import { calculateRisk } from './riskEngine.js';

export class InvalidInputError extends Error {
  constructor(message, details) { super(message); this.name = 'InvalidInputError'; this.details = details; }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };

function validate(shipment, telemetry, cfg) {
  const errs = [];
  const L = cfg.limits;
  if (!shipment || typeof shipment !== 'object') errs.push({ field: 'shipment', message: 'required object' });
  else if (!isNum(shipment.baselineShelfLifeHours) || shipment.baselineShelfLifeHours <= 0 || shipment.baselineShelfLifeHours > L.baselineHoursMax)
    errs.push({ field: 'baselineShelfLifeHours', message: `required number > 0 and <= ${L.baselineHoursMax}` });
  if (!telemetry || typeof telemetry !== 'object') errs.push({ field: 'telemetry', message: 'required object' });
  else {
    const { temperature: t, humidity: h, transitMinutes: m } = telemetry;
    if (!isNum(t) || t < L.temperatureC[0] || t > L.temperatureC[1]) errs.push({ field: 'temperature', message: `required number between ${L.temperatureC[0]} and ${L.temperatureC[1]}` });
    if (!isNum(h) || h < L.humidityPct[0] || h > L.humidityPct[1]) errs.push({ field: 'humidity', message: `required number between ${L.humidityPct[0]} and ${L.humidityPct[1]}` });
    if (!isNum(m) || m < 0 || m > L.transitMinutesMax) errs.push({ field: 'transitMinutes', message: `required number between 0 and ${L.transitMinutesMax}` });
  }
  if (errs.length) throw new InvalidInputError('Invalid shelf-life input', errs);
}

// ---- the three stress functions (exported so each can be explained and tested alone) ----

export function temperatureStress(tempC, cfg = MODEL_CONFIG, sensitivity = 1) {
  const T = cfg.temperature;
  let stress = 0;
  for (const b of T.bands) stress += Math.max(0, Math.min(tempC, b.toC) - b.fromC) * b.stressPerC;
  stress *= sensitivity;
  if (tempC < T.freezingBelowC) stress += (T.freezingBelowC - tempC) * T.freezingStressPerC;
  return round(stress, cfg.rounding.stress);
}

export function humidityStress(humidityPct, cfg = MODEL_CONFIG) {
  const H = cfg.humidity;
  const deviation = humidityPct > H.idealMaxPct ? humidityPct - H.idealMaxPct : humidityPct < H.idealMinPct ? H.idealMinPct - humidityPct : 0;
  const moderate = Math.min(deviation, H.moderateDeviationPts);
  const severe = Math.max(0, deviation - H.moderateDeviationPts);
  return round(moderate * H.moderateStressPerPt + severe * H.severeStressPerPt, cfg.rounding.stress);
}

export function transitStress(transitMinutes, cfg = MODEL_CONFIG) {
  const R = cfg.transit;
  const extraHours = Math.max(0, transitMinutes - R.graceMinutes) / 60;
  return round(Math.min(extraHours * R.stressPerExtraHour, R.maxStress), cfg.rounding.stress);
}

// ---- main entry point ----

export function calculateShelfLife(shipment, telemetry, cfg = MODEL_CONFIG) {
  validate(shipment, telemetry, cfg);
  const { baselineShelfLifeHours: baseline } = shipment;
  const { temperature, humidity, transitMinutes } = telemetry;

  const key = String(shipment.produceType ?? '').trim().toLowerCase();
  const profileName = Object.hasOwn(cfg.produceProfiles, key) ? key : 'default';
  const sensitivity = cfg.produceProfiles[profileName].temperatureSensitivity;

  const tStress = temperatureStress(temperature, cfg, sensitivity);
  const hStress = humidityStress(humidity, cfg);
  const rStress = transitStress(transitMinutes, cfg);
  const multiplier = round(1 + tStress + hStress + rStress, cfg.rounding.stress);

  const elapsedHours = transitMinutes / 60;
  const expired = elapsedHours >= baseline;                 // in transit longer than the whole baseline life
  const rawRemaining = expired ? 0 : baseline / multiplier;
  const remainingHours = round(rawRemaining, cfg.rounding.hours);
  const risk = calculateRisk(remainingHours, cfg);

  // Explainability: human-readable factors + numeric contributions.
  const T = cfg.temperature, H = cfg.humidity;
  const factorDetails = [];
  if (temperature < T.freezingBelowC) factorDetails.push({ kind: 'temperature', factor: 'Sub-zero temperature (freezing risk)', stress: tStress, detail: `${temperature}C is below ${T.freezingBelowC}C` });
  else if (tStress > 0) factorDetails.push({ kind: 'temperature', factor: temperature > T.coldChainLimitC ? 'Elevated temperature exposure' : 'Mildly elevated temperature', stress: tStress, detail: `${temperature}C vs optimal <= ${T.optimalMaxC}C (cold-chain limit ${T.coldChainLimitC}C)` });
  if (hStress > 0) factorDetails.push({ kind: 'humidity', factor: humidity > H.idealMaxPct ? 'High humidity' : 'Low humidity', stress: hStress, detail: `${humidity}% vs ideal ${H.idealMinPct}-${H.idealMaxPct}%` });
  if (rStress > 0) factorDetails.push({ kind: 'transit', factor: 'Extended transit duration', stress: rStress, detail: `${round(elapsedHours, 2)}h in transit vs ${cfg.transit.graceMinutes / 60}h normal` });
  if (expired) factorDetails.push({ kind: 'transit', factor: 'Transit time exceeded baseline shelf life', stress: 0, detail: `${round(elapsedHours, 1)}h in transit >= ${baseline}h baseline` });
  const factors = factorDetails.length ? factorDetails.map((f) => f.factor) : ['Within optimal cold-chain conditions'];

  const extra = tStress + hStress + rStress;
  const share = (s) => (extra > 0 ? round((s / extra) * 100, cfg.rounding.percent) : 0);

  return {
    remainingHours,
    remainingDays: round(remainingHours / 24, 1),
    degradationPercentage: round((1 - rawRemaining / baseline) * 100, cfg.rounding.percent),
    riskLevel: risk.level,
    factors,
    contributions: { temperatureStress: tStress, humidityStress: hStress, transitStress: rStress },
    contributionSharePct: { temperature: share(tStress), humidity: share(hStress), transit: share(rStress) },
    degradationMultiplier: multiplier,
    spoilageRate: multiplier, // alias kept for the stored telemetry column and the existing API/UI
    elapsedHours: round(elapsedHours, 2),
    factorDetails,
    risk,
    formula: expired
      ? `transit ${round(elapsedHours, 1)}h >= baseline ${baseline}h, so remaining = 0h`
      : `${baseline}h / (1 + ${tStress} temp + ${hStress} humidity + ${rStress} transit) = ${baseline}h / ${multiplier} = ${remainingHours}h`,
    model: { version: cfg.version, produceProfile: profileName, temperatureSensitivity: sensitivity },
  };
}
