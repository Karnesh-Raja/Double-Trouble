// Data access. Every query is parameterised (no string-built SQL), and rows are mapped to camelCase JSON.
import { getDb } from './db.js';

const now = () => new Date().toISOString();
const db = () => getDb();
const jsonOr = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };

const mapShipment = (r) => !r ? null : ({
  id: r.id, shipmentId: r.id, produceType: r.produce_type, origin: r.origin, destination: r.destination,
  baselineShelfLifeHours: r.baseline_shelf_life_hours, quantity: r.quantity, basePricePerKg: r.base_price_per_kg,
  status: r.status, riskLevel: r.risk_level, remainingHours: r.remaining_hours, lastTelemetryAt: r.last_telemetry_at, createdAt: r.created_at,
});
const mapTelemetry = (r) => !r ? null : ({
  id: r.id, shipmentId: r.shipment_id, temperature: r.temperature, humidity: r.humidity, transitMinutes: r.transit_minutes,
  spoilageRate: r.spoilage_rate, remainingHours: r.remaining_hours, riskLevel: r.risk_level, source: r.source, recordedAt: r.recorded_at,
});
const mapAlert = (r) => !r ? null : ({
  id: r.id, shipmentId: r.shipment_id, telemetryId: r.telemetry_id, severity: r.severity, message: r.message, isRead: !!r.is_read, createdAt: r.created_at,
});
const mapListing = (r) => !r ? null : ({
  id: r.id, shipmentId: r.shipment_id, produceType: r.produce_type, quantity: r.quantity,
  originalPricePerKg: r.original_price_per_kg, pricePerKg: r.price_per_kg, markdownPct: r.markdown_pct,
  remainingHours: r.remaining_hours, status: r.status, retailerNotified: !!r.retailer_notified, notifiedAt: r.notified_at,
  liquidationId: r.liquidation_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const shipments = {
  list: () => db().prepare('SELECT * FROM shipments ORDER BY created_at, id').all().map(mapShipment),
  count: () => db().prepare('SELECT COUNT(*) AS n FROM shipments').get().n,
  findById: (id) => mapShipment(db().prepare('SELECT * FROM shipments WHERE id = ?').get(id)),
  insert: (s) => db().prepare(`INSERT INTO shipments (id, produce_type, origin, destination, baseline_shelf_life_hours, quantity, base_price_per_kg, status, risk_level, remaining_hours, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_TRANSIT', 'LOW', ?, ?)`).run(s.id, s.produceType, s.origin, s.destination, s.baselineShelfLifeHours, s.quantity, s.basePricePerKg, s.baselineShelfLifeHours, now()),
  updateState: (id, riskLevel, remainingHours, at) => db().prepare('UPDATE shipments SET risk_level = ?, remaining_hours = ?, last_telemetry_at = ? WHERE id = ?').run(riskLevel, remainingHours, at, id),
};

export const telemetry = {
  insert: (t) => Number(db().prepare(`INSERT INTO telemetry (shipment_id, temperature, humidity, transit_minutes, spoilage_rate, remaining_hours, risk_level, source, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.shipmentId, t.temperature, t.humidity, t.transitMinutes, t.spoilageRate, t.remainingHours, t.riskLevel, t.source, t.recordedAt).lastInsertRowid),
  byId: (id) => mapTelemetry(db().prepare('SELECT * FROM telemetry WHERE id = ?').get(id)),
  latest: (shipmentId) => mapTelemetry(db().prepare('SELECT * FROM telemetry WHERE shipment_id = ? ORDER BY id DESC LIMIT 1').get(shipmentId)),
  // most recent N readings, returned oldest-first for charting
  history: (shipmentId, limit) => db().prepare('SELECT * FROM telemetry WHERE shipment_id = ? ORDER BY id DESC LIMIT ?').all(shipmentId, limit).map(mapTelemetry).reverse(),
  count: (shipmentId) => db().prepare('SELECT COUNT(*) AS n FROM telemetry WHERE shipment_id = ?').get(shipmentId).n,
};

export const alerts = {
  insert: (a) => Number(db().prepare('INSERT INTO alerts (shipment_id, telemetry_id, severity, message, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(a.shipmentId, a.telemetryId, a.severity, a.message, now()).lastInsertRowid),
  byId: (id) => mapAlert(db().prepare('SELECT * FROM alerts WHERE id = ?').get(id)),
  list: ({ unreadOnly } = {}) => db().prepare(`SELECT * FROM alerts ${unreadOnly ? 'WHERE is_read = 0' : ''} ORDER BY id`).all().map(mapAlert), // oldest first
  markRead: (id) => db().prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(id).changes,
  count: () => db().prepare('SELECT COUNT(*) AS n FROM alerts').get().n,
};

export const liquidations = {
  insert: (l) => Number(db().prepare('INSERT INTO liquidations (shipment_id, telemetry_id, risk_level, plan_json, created_at) VALUES (?, ?, ?, ?, ?)').run(l.shipmentId, l.telemetryId, l.riskLevel, JSON.stringify(l.plan), now()).lastInsertRowid),
  latest: (shipmentId) => {
    const r = db().prepare('SELECT * FROM liquidations WHERE shipment_id = ? ORDER BY id DESC LIMIT 1').get(shipmentId);
    return r ? { id: r.id, shipmentId: r.shipment_id, telemetryId: r.telemetry_id, createdAt: r.created_at, ...jsonOr(r.plan_json, {}) } : null;
  },
  count: (shipmentId) => db().prepare('SELECT COUNT(*) AS n FROM liquidations WHERE shipment_id = ?').get(shipmentId).n,
  // full recommendation history for one shipment, oldest first (every distinct price decision the engine made)
  history: (shipmentId) => db().prepare('SELECT * FROM liquidations WHERE shipment_id = ? ORDER BY id').all(shipmentId)
    .map((r) => ({ id: r.id, shipmentId: r.shipment_id, telemetryId: r.telemetry_id, createdAt: r.created_at, ...jsonOr(r.plan_json, {}) })),
};

export const marketplace = {
  findOpen: (shipmentId) => mapListing(db().prepare("SELECT * FROM marketplace_listings WHERE shipment_id = ? AND status = 'OPEN'").get(shipmentId)),
  // Insert the OPEN listing or re-price the existing one (retailers are notified when a listing is first created).
  upsertOpen: (l) => {
    const open = db().prepare("SELECT id FROM marketplace_listings WHERE shipment_id = ? AND status = 'OPEN'").get(l.shipmentId);
    const t = now();
    if (open) {
      db().prepare('UPDATE marketplace_listings SET price_per_kg = ?, original_price_per_kg = ?, markdown_pct = ?, remaining_hours = ?, quantity = ?, liquidation_id = ?, updated_at = ? WHERE id = ?')
        .run(l.pricePerKg, l.originalPricePerKg, l.markdownPct, l.remainingHours, l.quantity, l.liquidationId ?? null, t, open.id);
      return { id: open.id, created: false };
    }
    const id = Number(db().prepare(`INSERT INTO marketplace_listings (shipment_id, produce_type, quantity, original_price_per_kg, price_per_kg, markdown_pct, remaining_hours, status, retailer_notified, notified_at, liquidation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, ?, ?, ?)`).run(l.shipmentId, l.produceType, l.quantity, l.originalPricePerKg, l.pricePerKg, l.markdownPct, l.remainingHours, t, l.liquidationId ?? null, t, t).lastInsertRowid);
    return { id, created: true };
  },
  withdraw: (shipmentId) => db().prepare("UPDATE marketplace_listings SET status = 'WITHDRAWN', updated_at = ? WHERE shipment_id = ? AND status = 'OPEN'").run(now(), shipmentId).changes,
  byId: (id) => mapListing(db().prepare('SELECT * FROM marketplace_listings WHERE id = ?').get(id)),
  list: ({ status } = {}) => db().prepare(`SELECT * FROM marketplace_listings ${status ? 'WHERE status = ?' : ''} ORDER BY id`).all(...(status ? [status] : [])).map(mapListing),
  // Listings joined to the live shipment risk and the recommendation that priced them (most urgent, i.e. least shelf life, first).
  // Older rows without liquidation_id fall back to the shipment's latest recommendation.
  listDetailed: ({ status, shipmentId } = {}) => {
    const where = [], args = [];
    if (status) { where.push('l.status = ?'); args.push(status); }
    if (shipmentId) { where.push('l.shipment_id = ?'); args.push(shipmentId); }
    return db().prepare(`SELECT l.*, s.risk_level AS shipment_risk, q.plan_json AS plan_json
      FROM marketplace_listings l
      JOIN shipments s ON s.id = l.shipment_id
      LEFT JOIN liquidations q ON q.id = COALESCE(l.liquidation_id, (SELECT MAX(id) FROM liquidations WHERE shipment_id = l.shipment_id))
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY l.remaining_hours ASC, l.id ASC`).all(...args)
      .map((r) => ({ ...mapListing(r), risk: r.shipment_risk, plan: jsonOr(r.plan_json, null) }));
  },
};

const mapInsight = (r) => !r ? null : ({
  id: r.id, shipmentId: r.shipment_id, telemetryId: r.telemetry_id, riskLevel: r.risk_level, source: r.source, model: r.model,
  promptVersion: r.prompt_version ?? null, latencyMs: r.latency_ms ?? null, attempts: r.attempts ?? null, failureType: r.failure_type ?? null,
  insight: jsonOr(r.insight_json, {}), error: r.error, createdAt: r.created_at,
});

export const insights = {
  insert: (i) => Number(db().prepare('INSERT INTO ai_insights (shipment_id, telemetry_id, risk_level, source, model, prompt_version, latency_ms, attempts, failure_type, insight_json, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(i.shipmentId, i.telemetryId, i.riskLevel, i.source, i.model ?? null, i.promptVersion ?? null, i.latencyMs ?? null, i.attempts ?? null, i.failureType ?? null, JSON.stringify(i.insight), i.error ?? null, now()).lastInsertRowid),
  latest: (shipmentId) => mapInsight(db().prepare('SELECT * FROM ai_insights WHERE shipment_id = ? ORDER BY id DESC LIMIT 1').get(shipmentId)),
  count: (shipmentId) => db().prepare('SELECT COUNT(*) AS n FROM ai_insights WHERE shipment_id = ?').get(shipmentId).n,
};

// AI observability log (timestamp, shipment, model, prompt version, status, latency, success). No prompt text, no secrets.
const mapCall = (r) => ({
  id: r.id, timestamp: r.created_at, shipmentId: r.shipment_id, telemetryId: r.telemetry_id, model: r.model, promptVersion: r.prompt_version,
  status: r.status, failureType: r.failure_type, success: !!r.success, attempts: r.attempts, latencyMs: r.latency_ms, error: r.error,
});
export const aiCalls = {
  insert: (c) => Number(db().prepare('INSERT INTO ai_calls (created_at, shipment_id, telemetry_id, model, prompt_version, status, failure_type, success, attempts, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(now(), c.shipmentId ?? null, c.telemetryId ?? null, c.model ?? null, c.promptVersion, c.status, c.failureType ?? null, c.success ? 1 : 0, c.attempts ?? 0, c.latencyMs ?? 0, c.error ?? null).lastInsertRowid),
  recent: (limit = 20) => db().prepare('SELECT * FROM ai_calls ORDER BY id DESC LIMIT ?').all(limit).map(mapCall),
  stats: () => {
    const r = db().prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status = 'ok' AND attempts > 1 THEN 1 ELSE 0 END) AS recoveredByRetry,
      AVG(CASE WHEN status != 'skipped' THEN latency_ms END) AS avgLatencyMs,
      MAX(CASE WHEN status != 'skipped' THEN latency_ms END) AS maxLatencyMs FROM ai_calls`).get();
    const attempted = (r.succeeded || 0) + (r.failed || 0);
    return {
      total: r.total, succeeded: r.succeeded || 0, failed: r.failed || 0, skipped: r.skipped || 0, recoveredByRetry: r.recoveredByRetry || 0,
      successRatePct: attempted ? Math.round(((r.succeeded || 0) / attempted) * 1000) / 10 : null,
      avgLatencyMs: r.avgLatencyMs == null ? null : Math.round(r.avgLatencyMs), maxLatencyMs: r.maxLatencyMs ?? null,
    };
  },
};
