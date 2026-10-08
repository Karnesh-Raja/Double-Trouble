// Reads the complete current state of a shipment from the database (single source of truth).
import { shipments, telemetry, alerts, liquidations, insights } from '../database/repositories.js';
import { calculateRisk } from '../engines/riskEngine.js';
import { findListingView } from './marketplaceService.js';
import { notFound } from '../utils/errors.js';

export function getShipmentState(shipmentId) {
  const shipment = shipments.findById(shipmentId);
  if (!shipment) throw notFound(`Shipment ${shipmentId}`);
  const latest = telemetry.latest(shipmentId);
  const active = shipment.riskLevel !== 'LOW';
  const insightRow = active ? insights.latest(shipmentId) : null;
  return {
    shipment,
    latestTelemetry: latest,
    currentRisk: latest ? calculateRisk(latest.remainingHours) : null,
    liquidation: active ? liquidations.latest(shipmentId) : null,
    marketplaceListing: findListingView(shipmentId),
    aiInsight: insightRow,
    alerts: alerts.list().filter((a) => a.shipmentId === shipmentId).slice(-5),
    counts: { telemetry: telemetry.count(shipmentId), liquidations: liquidations.count(shipmentId), insights: insights.count(shipmentId) },
  };
}
