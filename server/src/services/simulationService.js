// SOFTWARE-SIMULATED TELEMETRY. There are no sensors or hardware; readings are generated here and then
// travel through exactly the same pipeline as a real reading would (processTelemetry).
import { shipments, telemetry } from '../database/repositories.js';
import { processTelemetry } from './telemetryService.js';
import { validateShipmentId } from '../utils/validators.js';
import { notFound } from '../utils/errors.js';

export const PROFILES = {
  normal: { temperature: 4, humidity: 78, transitMinutes: 180 },
  spike: { temperature: 12, humidity: 85, transitMinutes: 240 },
};

export function generateTelemetry(kind, shipmentId, lastTransitMinutes = 0) {
  const p = PROFILES[kind];
  return { shipmentId, temperature: p.temperature, humidity: p.humidity, transitMinutes: Math.max(p.transitMinutes, lastTransitMinutes) };
}

export async function runSimulation(kind, shipmentId) {
  validateShipmentId(shipmentId);
  if (!shipments.findById(shipmentId)) throw notFound(`Shipment ${shipmentId}`);
  const last = telemetry.latest(shipmentId);
  const reading = generateTelemetry(kind, shipmentId, last?.transitMinutes ?? 0);
  const result = await processTelemetry(reading, { source: `simulated-${kind}`, forceAnalysis: kind === 'spike', operation: `simulate.${kind}` });
  return { simulated: true, reading, ...result };
}
