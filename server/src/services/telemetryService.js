// ORCHESTRATION: processTelemetry()
//   receive -> validate -> persist -> shelf life -> risk -> liquidation -> alert -> marketplace -> AI -> updated state
// Steps 3-9 (all database writes) happen in ONE transaction, so state is never half-updated.
// The AI call runs after the commit: a slow or failed AI call can never lose telemetry or alerts.
import { transaction } from '../database/db.js';
import { shipments, telemetry, alerts, liquidations, marketplace, insights } from '../database/repositories.js';
import { calculateShelfLife } from '../engines/shelfLifeEngine.js';
import { RANK } from '../engines/riskEngine.js';
import { planLiquidation } from '../engines/liquidationEngine.js';
import { generateInsight } from './aiService.js';
import { validateTelemetryInput } from '../utils/validators.js';
import { notFound } from '../utils/errors.js';
import { logger, serializeError } from '../utils/logger.js';
import { getShipmentState } from './stateService.js';

export async function processTelemetry(input, { source = 'api', forceAnalysis = false, operation = 'telemetry.ingest' } = {}) {
  const started = process.hrtime.bigint();
  const data = validateTelemetryInput(input);                       // 1. validate (400)
  if (!shipments.findById(data.shipmentId)) throw notFound(`Shipment ${data.shipmentId}`); // unknown shipment (404)

  const steps = [];
  const outcome = transaction(() => {
    const shipment = shipments.findById(data.shipmentId);
    const previousRisk = shipment.riskLevel;

    // 2. shelf-life engine + 3. risk engine (pure functions)
    const shelfLife = calculateShelfLife(shipment, data);   // shipment: produce type + baseline; data: temperature, humidity, transit
    const risk = shelfLife.risk;                           // risk engine is applied inside, from remaining hours
    steps.push({ step: 'shelfLife', status: 'done', detail: shelfLife.formula }, { step: 'risk', status: 'done', detail: `${previousRisk} -> ${risk.level}` });

    // 4. persist telemetry + updated shipment state
    const recordedAt = new Date().toISOString();
    const telemetryId = telemetry.insert({ ...data, source, spoilageRate: shelfLife.spoilageRate, remainingHours: shelfLife.remainingHours, riskLevel: risk.level, recordedAt });
    shipments.updateState(shipment.id, risk.level, shelfLife.remainingHours, recordedAt);
    steps.push({ step: 'persistTelemetry', status: 'done', detail: `telemetry #${telemetryId}` });

    const levelChanged = previousRisk !== risk.level;
    const escalated = RANK[risk.level] > RANK[previousRisk];
    let plan = null, alertId = null, listing = null, discountIncreased = false, alertWorthy = false;

    if (risk.level !== 'LOW') {
      // 5. liquidation engine: the backend sets the discount from remaining shelf life (bands in liquidationConfig.js)
      plan = planLiquidation({ riskLevel: risk.level, remainingHours: shelfLife.remainingHours, temperature: data.temperature, spoilageRate: shelfLife.spoilageRate, quantity: shipment.quantity, basePricePerKg: shipment.basePricePerKg, produceType: shipment.produceType });
      const prev = liquidations.latest(shipment.id);
      let liquidationId = null;
      if (plan.priced) {
        // Persist every distinct recommendation (new episode, or any change of discount, price or urgency); identical repeats are not re-stored.
        const same = prev && previousRisk !== 'LOW' && prev.discountPercentage === plan.discountPercentage && prev.recommendedPrice === plan.recommendedPrice && prev.urgency === plan.urgency;
        liquidationId = same ? prev.id : liquidations.insert({ shipmentId: shipment.id, telemetryId, riskLevel: risk.level, plan });
        const prevDiscount = previousRisk === 'LOW' ? 0 : (prev?.discountPercentage ?? prev?.markdownPct ?? 0);
        discountIncreased = plan.discountPercentage > prevDiscount;
        steps.push({ step: 'liquidation', status: same ? 'unchanged' : 'saved', detail: `${plan.discountPercentage}% markdown, ${plan.originalPrice} -> ${plan.recommendedPrice} per kg (${plan.band})` });
      } else {
        steps.push({ step: 'liquidation', status: 'skipped_invalid_price', detail: plan.reason });
      }

      // 6. alert: when risk gets worse OR the discount deepens (e.g. 50% -> 70% inside CRITICAL); repeated identical readings do not spam
      alertWorthy = escalated || discountIncreased;
      if (alertWorthy) {
        const offer = plan.priced
          ? `Retailer liquidation recommendation generated: ${plan.discountPercentage}% markdown (${plan.originalPrice} to ${plan.recommendedPrice} per kg).`
          : 'Liquidation recommendation unavailable: the market price is missing or invalid.';
        alertId = alerts.insert({
          shipmentId: shipment.id, telemetryId, severity: risk.level,
          message: `${shipment.id} has approximately ${Math.round(shelfLife.remainingHours)} hours of estimated shelf life remaining (${data.temperature}C). ${offer}`,
        });
      }
      steps.push({ step: 'alert', status: alertWorthy ? 'created' : 'skipped', detail: alertWorthy ? `alert #${alertId}` : 'risk did not escalate and the discount did not deepen' });

      // 7. marketplace listing (single OPEN listing per shipment, re-priced automatically on later readings; no manual update)
      if (plan.priced) {
        const up = marketplace.upsertOpen({ shipmentId: shipment.id, produceType: shipment.produceType, quantity: shipment.quantity, originalPricePerKg: plan.originalPrice, pricePerKg: plan.recommendedPrice, markdownPct: plan.discountPercentage, remainingHours: shelfLife.remainingHours, liquidationId });
        listing = up.id;
        steps.push({ step: 'marketplace', status: up.created ? 'listed_and_retailers_notified' : 'repriced', detail: `listing #${up.id}` });
      } else {
        steps.push({ step: 'marketplace', status: 'skipped_invalid_price' });
      }
    } else {
      const withdrawn = marketplace.withdraw(shipment.id);
      steps.push({ step: 'liquidation', status: 'not_required' }, { step: 'alert', status: 'skipped' }, { step: 'marketplace', status: withdrawn ? 'listing_withdrawn' : 'none' });
    }
    return { shipment, previousRisk, shelfLife, risk, plan, telemetryId, alertId, listingId: listing, levelChanged, escalated, alertWorthy };
  });

  // 8. AI analysis (after commit). Runs when an alert is raised (risk escalated or discount deepened), or always when forced (the demo spike endpoint).
  let ai = null;
  if (outcome.risk.level !== 'LOW' && outcome.plan?.priced && (outcome.alertWorthy || forceAnalysis)) {
    ai = await generateInsight({ shipment: outcome.shipment, telemetryId: outcome.telemetryId, temperature: data.temperature, humidity: data.humidity, shelfLife: outcome.shelfLife, risk: outcome.risk, plan: outcome.plan });
    try {
      insights.insert({ shipmentId: data.shipmentId, telemetryId: outcome.telemetryId, riskLevel: outcome.risk.level, source: ai.source, model: ai.model, promptVersion: ai.promptVersion, latencyMs: ai.latencyMs, attempts: ai.attempts, failureType: ai.failureType, insight: ai.insight, error: ai.error });
    } catch (err) {
      logger.error({ operation: 'ai.persist', shipmentId: data.shipmentId, result: 'error', error: serializeError(err) });
    }
    if (ai.status === 'failed') logger.warn({ operation: 'ai.generate', shipmentId: data.shipmentId, result: 'fallback_used', error: { message: ai.error } });
    steps.push({ step: 'ai', status: ai.status, detail: `${ai.source} | prompt ${ai.promptVersion} | ${ai.latencyMs}ms | ${ai.attempts} attempt(s)` });
  } else {
    steps.push({ step: 'ai', status: 'skipped', detail: outcome.risk.level === 'LOW' ? 'risk is LOW' : !outcome.plan?.priced ? 'no valid price to analyse' : 'no escalation' });
  }

  // 9. return the complete updated state, read back from the database
  const state = getShipmentState(data.shipmentId);
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  logger.info({ operation, shipmentId: data.shipmentId, result: `${outcome.previousRisk}->${outcome.risk.level}`, remainingHours: outcome.shelfLife.remainingHours, ai: ai?.status ?? 'skipped', aiLatencyMs: ai?.latencyMs ?? null, durationMs });

  return {
    status: 'ok', operation, durationMs,
    transition: { previousRisk: outcome.previousRisk, currentRisk: outcome.risk.level, escalated: outcome.escalated },
    shelfLife: (({ risk, ...rest }) => rest)(outcome.shelfLife),
    risk: outcome.risk,
    pipeline: steps,
    ...state,
    newAlert: outcome.alertId ? alerts.byId(outcome.alertId) : null,
  };
}
