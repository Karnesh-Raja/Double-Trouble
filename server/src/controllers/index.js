import { ping } from '../database/db.js';
import { shipments, telemetry, alerts, liquidations, insights, aiCalls } from '../database/repositories.js';
import * as market from '../services/marketplaceService.js';
import { createShipment } from '../services/shipmentService.js';
import { processTelemetry } from '../services/telemetryService.js';
import { runSimulation } from '../services/simulationService.js';
import { getShipmentState } from '../services/stateService.js';
import { aiConfigured, PROMPT_VERSION } from '../services/aiService.js';
import { config } from '../utils/config.js';
import { notFound, badRequest, AppError } from '../utils/errors.js';
import { validateShipmentId } from '../utils/validators.js';

const requireShipment = (res, id) => {
  validateShipmentId(id);
  res.locals.shipmentId = id;
  const s = shipments.findById(id);
  if (!s) throw notFound(`Shipment ${id}`);
  return s;
};

export const health = (req, res) => {
  let database = 'ok';
  try { ping(); } catch { database = 'unavailable'; }
  const ok = database === 'ok';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', service: 'agrosense-api', time: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()), database, ai: { configured: aiConfigured(), model: config.ai.model, promptVersion: PROMPT_VERSION } });
};

export const listShipments = (req, res) => res.json(shipments.list());
export const getShipment = (req, res) => { requireShipment(res, req.params.id); res.json(getShipmentState(req.params.id)); };
export const postShipment = (req, res) => { const s = createShipment(req.body); res.locals.shipmentId = s.id; res.status(201).json(s); };

export const getTelemetry = (req, res) => {
  requireShipment(res, req.params.shipmentId);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  res.json(telemetry.history(req.params.shipmentId, limit));
};
export const postTelemetry = async (req, res) => {
  res.locals.shipmentId = typeof req.body?.shipmentId === 'string' ? req.body.shipmentId : null;
  res.status(201).json(await processTelemetry(req.body, { source: 'api', operation: 'telemetry.ingest' }));
};

export const simulateSpike = async (req, res) => { res.locals.shipmentId = req.params.shipmentId; res.status(201).json(await runSimulation('spike', req.params.shipmentId)); };
export const simulateNormal = async (req, res) => { res.locals.shipmentId = req.params.shipmentId; res.status(201).json(await runSimulation('normal', req.params.shipmentId)); };

export const listAlerts = (req, res) => res.json(alerts.list({ unreadOnly: req.query.unread === 'true' }));
export const readAlert = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw badRequest('Alert id must be a positive integer');
  if (!alerts.byId(id)) throw notFound(`Alert ${id}`);
  alerts.markRead(id);
  res.json(alerts.byId(id));
};

// 404 here means "nothing to show" (risk is LOW or none generated yet); the UI treats it as an empty state.
export const getLiquidation = (req, res) => {
  const s = requireShipment(res, req.params.shipmentId);
  const plan = s.riskLevel === 'LOW' ? null : liquidations.latest(s.id);
  if (!plan) throw new AppError(404, 'NO_LIQUIDATION', `No liquidation recommendation for ${s.id}`);
  res.json(plan);
};
export const getInsight = (req, res) => {
  const s = requireShipment(res, req.params.shipmentId);
  const row = s.riskLevel === 'LOW' ? null : insights.latest(s.id);
  if (!row) throw new AppError(404, 'NO_INSIGHT', `No AI insight for ${s.id}`);
  res.json(row);
};
export const getLiquidationHistory = (req, res) => {
  const s = requireShipment(res, req.params.shipmentId);
  res.json(liquidations.history(s.id)); // every distinct recommendation, oldest first (may be empty)
};

// Active produce lots, most urgent first. ?status=all also returns withdrawn lots.
export const getMarketplace = (req, res) => res.json(market.listMarketplace({ includeAll: req.query.status === 'all' }));
export const getMarketplaceSummary = (req, res) => res.json(market.getSummary());
export const getMarketplaceListing = (req, res) => { res.locals.shipmentId = req.params.shipmentId; res.json(market.getListing(req.params.shipmentId)); };

// AI observability: aggregate health of the AI layer + the most recent calls. Contains no prompts, responses or secrets.
export const getAiTelemetry = (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  res.json({ promptVersion: PROMPT_VERSION, model: config.ai.model, configured: aiConfigured(), stats: aiCalls.stats(), recent: aiCalls.recent(limit) });
};
