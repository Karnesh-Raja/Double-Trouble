// MARKETPLACE VIEW. Turns stored listings (written by the telemetry pipeline) into the API shape the UI renders.
// Every number and label here comes from the database or the liquidation config; nothing is computed in the browser.
import { shipments, marketplace } from '../database/repositories.js';
import { estimateValue } from '../engines/liquidationEngine.js';
import { LIQUIDATION_CONFIG as CFG } from '../engines/liquidationConfig.js';
import { validateShipmentId } from '../utils/validators.js';
import { AppError, notFound } from '../utils/errors.js';

const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `${CFG.currencySymbol}${Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toFixed(2)}`;
export const hoursLabel = (h) => {
  if (h < 1) return 'LESS THAN 1 HOUR LEFT';
  const n = Math.round(h);
  return `${n} ${n === 1 ? 'HOUR' : 'HOURS'} LEFT`;
};
const pctLabel = (p) => `${Number.isInteger(p) ? p : p.toFixed(1)}% OFF`;

export function toListingView(row) {
  const plan = row.plan;
  const open = row.status === 'OPEN';
  const risk = row.risk;
  const urgency = open && plan?.urgency ? plan.urgency : risk; // a withdrawn lot is no longer urgent
  const value = estimateValue({ quantity: row.quantity, originalPrice: row.originalPricePerKg, recommendedPrice: row.pricePerKg, sellThroughRate: plan?.sellThroughRate ?? CFG.sellThroughRate });
  const urgencyLabel = CFG.urgencyLabels[urgency] ?? null;
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    produce: row.produceType,
    quantity: row.quantity,
    unit: 'kg',
    currency: CFG.currency,
    originalPrice: row.originalPricePerKg,
    discount: row.markdownPct,
    recommendedPrice: row.pricePerKg,
    remainingShelfLifeHours: row.remainingHours,
    risk,
    urgency,
    urgencyLabel,
    band: plan?.band ?? null,
    reason: plan?.reason ?? null,
    sellWithinHours: plan?.sellWithinHours ?? null,
    status: row.status,
    retailerNotified: row.retailerNotified,
    liquidationId: row.liquidationId ?? plan?.id ?? null,
    listedAt: row.createdAt,
    updatedAt: row.updatedAt,
    value: { potentialLoss: value.potentialLoss, estimatedRecovery: value.estimatedRecovery, estimatedLossAvoided: value.estimatedLossAvoided, residualLoss: value.residualLoss, sellThroughRate: value.sellThroughRate },
    // Ready-to-render strings, so the frontend only displays.
    display: {
      title: String(row.produceType).toUpperCase(),
      original: money(row.originalPricePerKg),
      recommended: money(row.pricePerKg),
      discount: pctLabel(row.markdownPct),
      timeLeft: hoursLabel(row.remainingHours),
      risk,
      urgency: open ? urgencyLabel : null,
      unitLabel: `per kg`,
    },
    // Backward-compatible names from the first marketplace contract.
    produceType: row.produceType, originalPricePerKg: row.originalPricePerKg, pricePerKg: row.pricePerKg, markdownPct: row.markdownPct, remainingHours: row.remainingHours,
  };
}

export const listMarketplace = ({ includeAll = false } = {}) => marketplace.listDetailed({ status: includeAll ? undefined : 'OPEN' }).map(toListingView);

// One shipment's active listing (null when it has none). Used by the shipment state payload.
export const findListingView = (shipmentId) => marketplace.listDetailed({ status: 'OPEN', shipmentId }).map(toListingView)[0] ?? null;

export function getListing(shipmentId) {
  validateShipmentId(shipmentId);
  if (!shipments.findById(shipmentId)) throw notFound(`Shipment ${shipmentId}`);
  const view = findListingView(shipmentId);
  if (!view) throw new AppError(404, 'NO_LISTING', `No active marketplace listing for ${shipmentId}`);
  return view;
}

// "Estimated loss avoided" across all active lots. See LIQUIDATION_LOGIC.md for the definition and its assumptions.
export function getSummary() {
  const lots = listMarketplace();
  const sum = (f) => r2(lots.reduce((t, l) => t + f(l), 0));
  const byUrgency = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const l of lots) if (l.urgency in byUrgency) byUrgency[l.urgency]++;
  const out = {
    currency: CFG.currency,
    activeListings: lots.length,
    totalQuantityKg: sum((l) => l.quantity),
    potentialLoss: sum((l) => l.value.potentialLoss),
    estimatedRecovery: sum((l) => l.value.estimatedRecovery),
    estimatedLossAvoided: sum((l) => l.value.estimatedLossAvoided),
    residualLoss: sum((l) => l.value.residualLoss),
    byUrgency,
    mostUrgentShipmentId: lots[0]?.shipmentId ?? null,
    assumptions: { sellThroughRate: CFG.sellThroughRate, basis: 'Without action the lot is written off; unsold discounted stock still spoils.' },
  };
  out.display = { lossAvoided: money(out.estimatedLossAvoided), potentialLoss: money(out.potentialLoss), residualLoss: money(out.residualLoss) };
  return out;
}
