import { ArrowRight } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { Card, RiskBadge, Skeleton, EmptyState } from './ui';
import { formatShelfLife, riskStyle, isNum } from '../utils/format';

function State({ tag, t, emphasis }) {
  const s = riskStyle(t.riskLevel);
  return (
    <div className={`flex-1 rounded-lg border-2 p-5 ${s.panel}`}>
      <p className="text-sm font-semibold text-slate-600">{tag}</p>
      <p className={`mt-1 text-4xl font-extrabold sm:text-5xl ${emphasis ? s.text : 'text-ink'}`}>{formatShelfLife(t.remainingHours)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <RiskBadge level={t.riskLevel} size="lg" />
        <span className={`text-sm font-bold ${s.text}`}>{s.word}</span>
      </div>
      <p className="mt-3 text-sm text-slate-700">{t.temperature}°C · {t.humidity}% humidity · spoilage rate {isNum(t.spoilageRate) ? `${t.spoilageRate}×` : '—'}</p>
    </div>
  );
}

// Before = earliest persisted reading, After = latest persisted reading. Both come from GET /api/telemetry.
export default function BeforeAfter() {
  const { telemetry, errors } = useAppData();
  if (telemetry === null && !errors.telemetry) return <Card title="Shelf-life transition"><Skeleton className="h-36 w-full" /></Card>;
  if (!telemetry?.length) return <Card title="Shelf-life transition"><EmptyState title="No telemetry recorded yet" hint="POST a reading to /api/telemetry to start monitoring." /></Card>;

  const before = telemetry[0];
  const after = telemetry[telemetry.length - 1];
  const spiked = telemetry.length > 1 && isNum(before.remainingHours) && isNum(after.remainingHours) && after.remainingHours < before.remainingHours * 0.5;

  return (
    <Card title="Shelf-life transition" className="border-2">
      {spiked ? (
        <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center" aria-live="polite">
          <State tag="Before spike" t={before} />
          <div className="flex flex-col items-center gap-1 text-center">
            <ArrowRight className="hidden h-8 w-8 text-slate-500 md:block" aria-hidden="true" />
            <p className="text-sm font-bold text-slate-700">{formatShelfLife(before.remainingHours)} → {formatShelfLife(after.remainingHours)}</p>
          </div>
          <State tag="After spike" t={after} emphasis />
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <State tag="Current state" t={after} />
          <p className="flex-1 text-sm text-slate-600">Conditions are stable. Use <strong>Simulate temperature spike</strong> to see the backend recompute shelf life and risk.</p>
        </div>
      )}
    </Card>
  );
}
