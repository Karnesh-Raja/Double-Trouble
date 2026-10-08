import { Router } from 'express';
import { asyncHandler as h } from '../middleware/asyncHandler.js';
import * as c from '../controllers/index.js';

const r = Router();
r.get('/health', c.health);

r.get('/shipments', h(c.listShipments));
r.get('/shipments/:id', h(c.getShipment));
r.post('/shipments', h(c.postShipment));

r.get('/telemetry/:shipmentId', h(c.getTelemetry));
r.post('/telemetry', h(c.postTelemetry));

r.post('/simulate/temperature-spike/:shipmentId', h(c.simulateSpike));
r.post('/simulate/normal/:shipmentId', h(c.simulateNormal)); // additive: resets the demo to NORMAL

r.get('/alerts', h(c.listAlerts));
r.patch('/alerts/:id/read', h(c.readAlert));

r.get('/liquidation/:shipmentId', h(c.getLiquidation));
r.get('/liquidation/:shipmentId/history', h(c.getLiquidationHistory)); // additive: audit trail of every recommendation
r.get('/ai-insights/:shipmentId', h(c.getInsight));
r.get('/ai-telemetry', h(c.getAiTelemetry)); // additive: AI observability (status, latency, prompt version)
r.get('/marketplace', h(c.getMarketplace));
r.get('/marketplace/summary', h(c.getMarketplaceSummary)); // additive: estimated loss avoided (declared before :shipmentId)
r.get('/marketplace/:shipmentId', h(c.getMarketplaceListing)); // additive: one shipment's active listing

export default r;
