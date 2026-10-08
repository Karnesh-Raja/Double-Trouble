import { AlertOctagon, AlertTriangle, ShieldCheck, RefreshCw, Inbox, WifiOff } from 'lucide-react';
import { riskStyle } from '../utils/format';

const ICON = { LOW: ShieldCheck, MEDIUM: AlertTriangle, HIGH: AlertTriangle, CRITICAL: AlertOctagon };

// Colour is never the only signal: every badge has an icon and a text label.
export function RiskBadge({ level, size = 'md' }) {
  const s = riskStyle(level);
  const Icon = ICON[level] || ShieldCheck;
  const pad = size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${pad} ${s.badge}`}>
      <Icon className={size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden="true" />
      {level ? `${s.label} RISK` : 'NO DATA'}
    </span>
  );
}

export const Skeleton = ({ className = 'h-6 w-24' }) => <div aria-hidden="true" className={`animate-pulse rounded bg-slate-200 ${className}`} />;

export function Card({ title, icon: Icon, action, children, className = '', as: Tag = 'section' }) {
  return (
    <Tag className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            {Icon && <Icon className="h-4 w-4 text-field-600" aria-hidden="true" />}{title}
          </h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </Tag>
  );
}

export function ErrorState({ title = 'Could not load data', error, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-red-800"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{title}</p>
      {error?.message && <p className="text-red-700">{error.message}</p>}
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 font-medium text-red-800 ring-1 ring-red-300 hover:bg-red-100">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center gap-1 py-6 text-center">
      <Icon className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function OfflineState({ onRetry }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-lg border border-red-200 bg-white p-6 text-center">
      <WifiOff className="mx-auto h-8 w-8 text-red-600" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold">Backend is offline</h2>
      <p className="mt-1 text-sm text-slate-600">The dashboard cannot reach <code>/api/health</code>. Start the Express server (default port 4000) and retry. No data is shown until the backend responds.</p>
      <button onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-md bg-field-600 px-4 py-2 text-sm font-medium text-white hover:bg-field-700">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />Retry connection
      </button>
    </div>
  );
}
