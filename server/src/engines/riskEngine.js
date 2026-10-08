// RISK ENGINE (pure). Maps remaining shelf-life hours to a risk level using configurable thresholds.
import { MODEL_CONFIG } from './modelConfig.js';

export const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function calculateRisk(remainingHours, cfg = MODEL_CONFIG) {
  if (typeof remainingHours !== 'number' || !Number.isFinite(remainingHours) || remainingHours < 0) {
    throw Object.assign(new Error('remainingHours must be a finite number >= 0'), { name: 'InvalidInputError', details: [{ field: 'remainingHours', message: 'must be a finite number >= 0' }] });
  }
  const { lowAboveHours: L, mediumAtOrAboveHours: M, highAtOrAboveHours: H } = cfg.risk;
  let level, reason;
  if (remainingHours > L) { level = 'LOW'; reason = `${remainingHours}h remaining is above ${L}h`; }
  else if (remainingHours >= M) { level = 'MEDIUM'; reason = `${remainingHours}h remaining is between ${M}h and ${L}h`; }
  else if (remainingHours >= H) { level = 'HIGH'; reason = `${remainingHours}h remaining is between ${H}h and ${M}h`; }
  else { level = 'CRITICAL'; reason = `${remainingHours}h remaining is below ${H}h`; }
  return { level, reasons: [reason], thresholds: { ...cfg.risk } };
}
