import { badRequest } from './errors.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function validateShipmentId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw badRequest('shipmentId is missing or invalid', [{ field: 'shipmentId', message: 'must be 1-40 chars: letters, digits, _ or -' }]);
  return id;
}

// Strict: JSON numbers only (no numeric strings), physical plausibility ranges.
export function validateTelemetryInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errs = [];
  if (typeof b.shipmentId !== 'string' || !ID_RE.test(b.shipmentId)) errs.push({ field: 'shipmentId', message: 'required string (letters, digits, _ or -, max 40)' });
  if (!isNum(b.temperature) || b.temperature < -30 || b.temperature > 60) errs.push({ field: 'temperature', message: 'required number between -30 and 60 (°C)' });
  if (!isNum(b.humidity) || b.humidity < 0 || b.humidity > 100) errs.push({ field: 'humidity', message: 'required number between 0 and 100 (%)' });
  if (!isNum(b.transitMinutes) || b.transitMinutes < 0 || b.transitMinutes > 60 * 24 * 60) errs.push({ field: 'transitMinutes', message: 'required number between 0 and 86400 (minutes)' });
  if (errs.length) throw badRequest('Invalid telemetry payload', errs);
  return { shipmentId: b.shipmentId, temperature: b.temperature, humidity: b.humidity, transitMinutes: b.transitMinutes };
}

export function validateShipmentInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errs = [];
  const str = (f) => { if (typeof b[f] !== 'string' || !b[f].trim() || b[f].length > 80) errs.push({ field: f, message: 'required non-empty string (max 80)' }); };
  const pos = (f, max, optional) => { if (b[f] === undefined && optional) return; if (!isNum(b[f]) || b[f] <= 0 || b[f] > max) errs.push({ field: f, message: `required positive number (max ${max})` }); };
  const id = b.shipmentId ?? b.id;
  if (id !== undefined && (typeof id !== 'string' || !ID_RE.test(id))) errs.push({ field: 'shipmentId', message: 'letters, digits, _ or -, max 40' });
  ['produceType', 'origin', 'destination'].forEach(str);
  pos('baselineShelfLifeHours', 2000);
  pos('quantity', 10_000_000);
  pos('basePricePerKg', 100_000, true);
  if (errs.length) throw badRequest('Invalid shipment payload', errs);
  return {
    id, produceType: b.produceType.trim(), origin: b.origin.trim(), destination: b.destination.trim(),
    baselineShelfLifeHours: b.baselineShelfLifeHours, quantity: b.quantity, basePricePerKg: b.basePricePerKg,
  };
}
