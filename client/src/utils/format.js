export const RISK = {
  LOW:      { label: 'LOW',      word: 'NORMAL',  badge: 'bg-emerald-100 text-emerald-900 ring-emerald-600/30', panel: 'border-emerald-300 bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500', hex: '#16a34a' },
  MEDIUM:   { label: 'MEDIUM',   word: 'WATCH',   badge: 'bg-yellow-100 text-yellow-900 ring-yellow-600/30', panel: 'border-yellow-300 bg-yellow-50', text: 'text-yellow-700', bar: 'bg-yellow-500', hex: '#ca8a04' },
  HIGH:     { label: 'HIGH',     word: 'WARNING', badge: 'bg-orange-100 text-orange-900 ring-orange-600/30', panel: 'border-orange-300 bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500', hex: '#ea580c' },
  CRITICAL: { label: 'CRITICAL', word: 'URGENT',  badge: 'bg-red-100 text-red-900 ring-red-600/30', panel: 'border-red-400 bg-red-50', text: 'text-red-700', bar: 'bg-red-600', hex: '#dc2626' },
};
export const riskStyle = (level) => RISK[level] || { label: level || 'UNKNOWN', word: '—', badge: 'bg-slate-100 text-slate-800 ring-slate-500/30', panel: 'border-slate-300 bg-white', text: 'text-slate-600', bar: 'bg-slate-400', hex: '#64748b' };

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Presentation only: converts backend hours into "4.9 days" / "18 hours".
export function formatShelfLife(hours) {
  if (!isNum(hours)) return '—';
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days`;
  return `${Math.round(hours)} hours`;
}
export function formatDuration(minutes) {
  if (!isNum(minutes)) return '—';
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}
export const inr = (n) => (isNum(n) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n) : '—');
export const timeLabel = (d) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

// Urgency is derived from the backend's remaining-hours number (display label only).
export function urgencyFromHours(h) {
  if (!isNum(h)) return { label: '—', cls: 'text-slate-500' };
  if (h < 24) return { label: 'Urgent: sell now', cls: 'text-red-700' };
  if (h < 48) return { label: 'High: sell within a day', cls: 'text-orange-700' };
  if (h < 96) return { label: 'Moderate', cls: 'text-yellow-700' };
  return { label: 'Normal', cls: 'text-emerald-700' };
}
