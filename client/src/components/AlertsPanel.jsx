import { Bell, Check } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { Card, EmptyState, ErrorState, Skeleton } from './ui';
import { riskStyle, timeLabel } from '../utils/format';

export default function AlertsPanel() {
  const { alerts, errors, refreshAll, markAlertRead } = useAppData();
  const unread = alerts?.filter((a) => !a.read).length || 0;
  let body;
  if (errors.alerts && !alerts) body = <ErrorState title="Alerts unavailable" error={errors.alerts} onRetry={refreshAll} />;
  else if (alerts === null) body = <Skeleton className="h-24 w-full" />;
  else if (!alerts.length) body = <EmptyState title="No alerts" hint="Alerts appear when a shipment's risk becomes MEDIUM or higher." icon={Bell} />;
  else body = (
    <ul className="max-h-80 space-y-2 overflow-y-auto">
      {[...alerts].reverse().map((a) => {
        const s = riskStyle(a.severity);
        return (
          <li key={a.id} className={`rounded-md border p-3 text-sm ${a.read ? 'border-slate-200 bg-slate-50 text-slate-600' : s.panel}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={`font-semibold ${a.read ? '' : s.text}`}>{a.severity} · {a.shipmentId}</p>
              <span className="text-xs text-slate-500">{timeLabel(a.time)}</span>
            </div>
            <p className="mt-1">{a.message}</p>
            {!a.read && (
              <button onClick={() => markAlertRead(a.id)} className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-white">
                <Check className="h-3 w-3" aria-hidden="true" />Mark as read
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
  return <Card title="Alerts" icon={Bell} action={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold" aria-label={`${unread} unread`}>{unread} unread</span>}>{body}</Card>;
}
