// OUTPUT VALIDATION. Nothing the model returns is trusted until it passes every check here.
// Checks: valid JSON, exactly the five string fields, length limits, urgency == deterministic risk, and a numeric guard
// (every number in the text must come from the supplied input, so the model cannot alter or invent shelf-life figures).
import { OUTPUT_LIMITS } from './prompt.js';

export const FIELDS = ['summary', 'riskExplanation', 'recommendedAction', 'retailerMessage', 'urgency'];
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export class AiOutputError extends Error {
  constructor(message) { super(message); this.name = 'AiOutputError'; }
}

function parseJsonObject(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const attempts = [raw];
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a > -1 && b > a) attempts.push(raw.slice(a, b + 1));
  for (const candidate of attempts) {
    try { const v = JSON.parse(candidate); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* try next */ }
  }
  throw new AiOutputError('reply was not a valid JSON object');
}

// All numbers the model is allowed to mention: every numeric value in the input (recursively), plus transit in hours.
function allowedNumbers(input) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) { out.add(v); out.add(Math.round(v)); out.add(Math.round(v * 10) / 10); out.add(Math.abs(v)); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  if (Number.isFinite(input.transitMinutes)) { const h = input.transitMinutes / 60; out.add(h); out.add(Math.round(h * 10) / 10); out.add(Math.round(h)); }
  if (Number.isFinite(input.remainingShelfLifeHours)) { const d = input.remainingShelfLifeHours / 24; out.add(Math.round(d * 10) / 10); out.add(Math.round(d)); }
  return [...out];
}

export function findInventedNumbers(text, input) {
  const allowed = allowedNumbers(input);
  const scrub = String(text).replaceAll(String(input.shipmentId ?? '\u0000'), ' ').replace(/(\d),(?=\d{3}\b)/g, '$1'); // drop the shipment id and thousands separators
  const found = scrub.match(/\d+(?:\.\d+)?/g) || [];
  return [...new Set(found.map(Number).filter((n) => !allowed.some((a) => Math.abs(a - n) < 0.051)))];
}

// Returns the cleaned 5-field object, or throws AiOutputError describing the first problem (used verbatim in the retry note).
export function validateAiOutput(text, input) {
  const obj = typeof text === 'object' && text !== null ? text : parseJsonObject(text);
  const out = {};
  for (const k of FIELDS) {
    const v = obj[k];
    if (typeof v !== 'string' || !v.trim()) throw new AiOutputError(`field "${k}" is missing or not a non-empty string`);
    out[k] = v.replace(/\s+/g, ' ').trim();
    const max = OUTPUT_LIMITS[k];
    if (max && out[k].length > max) throw new AiOutputError(`field "${k}" is ${out[k].length} characters, the limit is ${max}`);
  }
  out.urgency = out.urgency.toUpperCase();
  if (!LEVELS.includes(out.urgency)) throw new AiOutputError('urgency must be one of LOW, MEDIUM, HIGH, CRITICAL');
  if (out.urgency !== input.riskLevel) throw new AiOutputError(`urgency "${out.urgency}" contradicts the deterministic riskLevel "${input.riskLevel}"`);
  const invented = findInventedNumbers(FIELDS.filter((k) => k !== 'urgency').map((k) => out[k]).join(' '), input);
  if (invented.length) throw new AiOutputError(`it contains numbers that are not in the supplied data (${invented.join(', ')})`);
  return out;
}
