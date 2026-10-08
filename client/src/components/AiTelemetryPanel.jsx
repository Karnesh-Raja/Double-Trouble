import { Activity } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { timeLabel } from '../utils/format';

const STATUS = {
  ok: { label: 'AI answered', cls: 'text-emerald-800' },
  failed: { label: 'Fallback used', cls: 'text-orange-800' },
  skipped: { label: 'No API key', cls: 'text-slate-600' },
};
const ms = (v) => (v == null ? '—' : `${v} ms`);

// AI observability: what the backend recorded about each AI request. No prompts, replies or secrets are ever shown.
export default function AiTelemetryPanel() {
  const { aiTelemetry: t } = useAppData();
  if (!t) return null;
  const s = t.stats;
  return (
    <details className="group mt-4 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-field-600">
        <Activity className="h-4 w-4 text-field-600" aria-hidden="true" />
        AI observability
        <span className="ml-auto text-xs font-normal text-slate-500">
          {s.total} call{s.total === 1 ? '' : 's'}{s.successRatePct != null ? `, ${s.successRatePct}% answered by the model` : ''}
        </span>
      </summary>
      <div className="border-t border-slate-200 p-3">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-600">Answered by model</dt><dd className="font-semibold">{s.succeeded}{s.recoveredByRetry ? ` (${s.recoveredByRetry} after retry)` : ''}</dd></div>
          <div><dt className="text-xs text-slate-600">Fell back</dt><dd className="font-semibold">{s.failed}</dd></div>
          <div><dt className="text-xs text-slate-600">Average latency</dt><dd className="font-semibold">{ms(s.avgLatencyMs)}</dd></div>
          <div><dt className="text-xs text-slate-600">Prompt version</dt><dd className="font-semibold">{t.promptVersion || '—'}</dd></div>
        </dl>
        {t.recent.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <caption className="sr-only">Most recent AI requests</caption>
              <thead className="text-slate-600"><tr><th className="py-1 pr-3 font-medium">Time</th><th className="pr-3 font-medium">Shipment</th><th className="pr-3 font-medium">Result</th><th className="pr-3 font-medium">Attempts</th><th className="pr-3 font-medium">Latency</th><th className="font-medium">Prompt</th></tr></thead>
              <tbody className="divide-y divide-slate-200">
                {t.recent.map((c) => {
                  const st = STATUS[c.status] || { label: c.status, cls: 'text-slate-700' };
                  return (
                    <tr key={c.id}>
                      <td className="py-1.5 pr-3 tabular-nums">{timeLabel(c.time)}</td>
                      <td className="pr-3">{c.shipmentId || '—'}</td>
                      <td className={`pr-3 font-medium ${st.cls}`}>{st.label}{c.failureType && c.status !== 'ok' ? ` (${c.failureType.replace(/_/g, ' ')})` : ''}</td>
                      <td className="pr-3 tabular-nums">{c.attempts ?? '—'}</td>
                      <td className="pr-3 tabular-nums">{ms(c.latencyMs)}</td>
                      <td>{c.promptVersion || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
