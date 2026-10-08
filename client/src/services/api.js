// Thin client for the shared AgroSense API contract. No secrets, no business logic.
const BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  } catch {
    throw new ApiError('Cannot reach the AgroSense backend', 0);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch { /* ignore */ }
    throw new ApiError(detail || `Request failed (${res.status}) for ${path}`, res.status);
  }
  return res.status === 204 ? null : res.json();
}

// 404 on per-shipment resources (liquidation, AI insight) means "none generated yet".
const optional = (p) => p.catch((e) => { if (e.status === 404) return null; throw e; });

export const api = {
  health: () => request('/api/health'),
  shipments: () => request('/api/shipments'),
  telemetry: (id) => request(`/api/telemetry/${encodeURIComponent(id)}`),
  spike: (id) => request(`/api/simulate/temperature-spike/${encodeURIComponent(id)}`, { method: 'POST' }),
  alerts: () => request('/api/alerts'),
  markAlertRead: (id) => request(`/api/alerts/${id}/read`, { method: 'PATCH' }),
  liquidation: (id) => optional(request(`/api/liquidation/${encodeURIComponent(id)}`)),
  insight: (id) => optional(request(`/api/ai-insights/${encodeURIComponent(id)}`)),
  aiTelemetry: () => optional(request('/api/ai-telemetry?limit=8')),
  marketplace: () => request('/api/marketplace'),
  marketplaceSummary: () => optional(request('/api/marketplace/summary')),
};
