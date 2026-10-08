// Adapter between the backend's row shape (snake_case from SQLite) and the UI.
// Tolerates camelCase too, so backend and frontend can evolve independently.
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return null; };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const parseTime = (s) => {
  if (!s) return null;
  const str = String(s);
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const iso = /(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const toArray = (x, key) => (Array.isArray(x) ? x : Array.isArray(x?.[key]) ? x[key] : Array.isArray(x?.data) ? x.data : []);
const up = (v) => (v ? String(v).toUpperCase() : null);

export const normShipment = (s) => ({
  id: pick(s, 'id', 'shipmentId', 'shipment_id'),
  produce: pick(s, 'produce_type', 'produceType'),
  origin: pick(s, 'origin'),
  destination: pick(s, 'destination'),
  quantity: num(pick(s, 'quantity')),
  baselineHours: num(pick(s, 'baseline_shelf_life_hours', 'baselineShelfLifeHours')),
  status: up(pick(s, 'status')) || 'IN_TRANSIT',
  riskLevel: up(pick(s, 'risk_level', 'riskLevel')),
  remainingHours: num(pick(s, 'remaining_hours', 'remainingHours')),
});

export const normTelemetry = (t) => {
  const time = parseTime(pick(t, 'recorded_at', 'recordedAt', 'timestamp', 'createdAt'));
  return {
    id: pick(t, 'id'),
    time,
    label: time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
    temperature: num(pick(t, 'temperature')),
    humidity: num(pick(t, 'humidity')),
    transitMinutes: num(pick(t, 'transit_minutes', 'transitMinutes')),
    spoilageRate: num(pick(t, 'spoilage_rate', 'spoilageRate')),
    remainingHours: num(pick(t, 'remaining_hours', 'remainingHours')),
    riskLevel: up(pick(t, 'risk_level', 'riskLevel')),
    source: pick(t, 'source'),
  };
};

export const normAlert = (a) => ({
  id: pick(a, 'id'),
  shipmentId: pick(a, 'shipment_id', 'shipmentId'),
  severity: up(pick(a, 'severity')),
  message: pick(a, 'message'),
  read: Boolean(pick(a, 'is_read', 'isRead', 'read')),
  time: parseTime(pick(a, 'created_at', 'createdAt')),
});

export function normLiquidation(raw) {
  if (!raw) return null;
  let p = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (!p) return null;
  p = p.plan ?? p;
  const pj = pick(p, 'plan_json', 'planJson');
  if (typeof pj === 'string') { try { p = JSON.parse(pj); } catch { /* keep */ } }
  return {
    required: p.required !== false,
    markdownPct: num(pick(p, 'markdownPct', 'markdown_pct', 'discountPct')),
    originalPrice: num(pick(p, 'originalPricePerKg', 'original_price_per_kg', 'originalPrice')),
    newPrice: num(pick(p, 'markdownPricePerKg', 'markdown_price_per_kg', 'recommendedPrice')),
    quantity: num(pick(p, 'quantity')),
    recovery: num(pick(p, 'estimatedRecovery', 'estimated_recovery')),
    lossAvoided: num(pick(p, 'estimatedLossAvoided', 'estimated_loss_avoided')),
    sellWithinHours: num(pick(p, 'sellWithinHours', 'sell_within_hours')),
    action: pick(p, 'action'),
    reason: pick(p, 'reason'),
    urgency: up(pick(p, 'urgency')),
    urgencyLabel: pick(p, 'urgencyLabel'),
  };
}

const toText = (v) => (v == null ? null : Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function normInsight(raw) {
  if (!raw) return null;
  const r = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (!r) return null;
  let body = pick(r, 'insight', 'analysis') ?? r;
  if (typeof body === 'string') { try { const j = JSON.parse(body); if (j && typeof j === 'object') body = j; } catch { /* plain text */ } }
  const meta = {
    source: pick(r, 'source'),
    time: parseTime(pick(r, 'created_at', 'createdAt')),
    model: pick(r, 'model'),
    promptVersion: pick(r, 'promptVersion', 'prompt_version'),
    latencyMs: num(pick(r, 'latencyMs', 'latency_ms')),
    attempts: num(pick(r, 'attempts')),
    error: pick(r, 'error'),
    failureType: pick(r, 'failureType', 'failure_type'),
  };
  if (typeof body === 'string') return { ...meta, text: body, sections: null };
  // Older records used { why, riskExplanation, recommendedAction, urgency }; they still render.
  const urgencyRaw = toText(pick(body, 'urgency'));
  const level = urgencyRaw && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(urgencyRaw.toUpperCase()) ? urgencyRaw.toUpperCase() : null;
  return {
    ...meta, text: null, urgencyLevel: level ?? up(pick(r, 'riskLevel', 'risk_level')),
    sections: {
      summary: toText(pick(body, 'summary', 'why', 'whyHappened', 'why_happened', 'cause')),
      risk: toText(pick(body, 'riskExplanation', 'risk_explanation', 'risk')),
      action: toText(pick(body, 'recommendedAction', 'recommended_action', 'action')),
      retailer: toText(pick(body, 'retailerMessage', 'retailer_message')),
      urgency: urgencyRaw,
    },
  };
}

export function normAiTelemetry(raw) {
  if (!raw) return null;
  const st = raw.stats || {};
  return {
    promptVersion: raw.promptVersion ?? null, model: raw.model ?? null, configured: Boolean(raw.configured),
    stats: { total: num(st.total) ?? 0, succeeded: num(st.succeeded) ?? 0, failed: num(st.failed) ?? 0, skipped: num(st.skipped) ?? 0, recoveredByRetry: num(st.recoveredByRetry) ?? 0, successRatePct: num(st.successRatePct), avgLatencyMs: num(st.avgLatencyMs), maxLatencyMs: num(st.maxLatencyMs) },
    recent: (Array.isArray(raw.recent) ? raw.recent : []).map((c) => ({
      id: c.id, time: parseTime(c.timestamp), shipmentId: c.shipmentId, model: c.model, promptVersion: c.promptVersion,
      status: c.status, failureType: c.failureType, success: Boolean(c.success), attempts: num(c.attempts), latencyMs: num(c.latencyMs),
    })),
  };
}

// Marketplace listings arrive fully priced by the backend (discount, price, urgency, display strings).
// Nothing is derived here: no price maths, no urgency thresholds.
export const normListing = (l) => {
  const d = l.display || {};
  return {
    id: pick(l, 'id'),
    shipmentId: pick(l, 'shipmentId', 'shipment_id'),
    produce: pick(l, 'produce', 'produceType', 'produce_type'),
    quantity: num(pick(l, 'quantity')),
    originalPrice: num(pick(l, 'originalPrice', 'originalPricePerKg', 'original_price_per_kg')),
    price: num(pick(l, 'recommendedPrice', 'pricePerKg', 'price_per_kg')),
    pct: num(pick(l, 'discount', 'markdownPct', 'markdown_pct')),
    remainingHours: num(pick(l, 'remainingShelfLifeHours', 'remainingHours', 'remaining_hours')),
    risk: up(pick(l, 'risk')),
    urgency: up(pick(l, 'urgency')),
    urgencyLabel: pick(l, 'urgencyLabel'),
    reason: pick(l, 'reason'),
    lossAvoided: num(l.value?.estimatedLossAvoided),
    status: up(pick(l, 'status')) || 'OPEN',
    display: { title: d.title ?? null, original: d.original ?? null, recommended: d.recommended ?? null, discount: d.discount ?? null, timeLeft: d.timeLeft ?? null, urgency: d.urgency ?? null },
  };
};

export function normMarketSummary(raw) {
  if (!raw) return null;
  const d = raw.display || {};
  return {
    activeListings: num(raw.activeListings) ?? 0,
    totalQuantityKg: num(raw.totalQuantityKg),
    lossAvoided: d.lossAvoided ?? null,
    potentialLoss: d.potentialLoss ?? null,
    residualLoss: d.residualLoss ?? null,
    sellThroughRate: num(raw.assumptions?.sellThroughRate),
  };
}
