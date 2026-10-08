import { TrendingDown } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { Card, EmptyState, ErrorState, Skeleton } from './ui';
import { inr, isNum, riskStyle, urgencyFromHours } from '../utils/format';

export default function LiquidationCard() {
  const { liquidation: l, shipment, errors, refreshAll } = useAppData();
  const loading = l === null && shipment === null;
  let body;
  if (errors.liquidation) body = <ErrorState title="Liquidation plan unavailable" error={errors.liquidation} onRetry={refreshAll} />;
  else if (loading) body = <Skeleton className="h-32 w-full" />;
  else if (!l || !l.required) body = <EmptyState title="No liquidation needed" hint="A markdown plan is created by the backend when risk rises above LOW." icon={TrendingDown} />;
  else {
    // urgency comes from the backend plan; the hours-based label is only a fallback for older records
    const fallback = urgencyFromHours(shipment?.remainingHours);
    const urgency = l.urgencyLabel ? { label: l.urgencyLabel, cls: riskStyle(l.urgency).text } : fallback;
    body = (
      <div>
        <p className="inline-block rounded bg-red-600 px-2.5 py-1 text-xs font-bold text-white">AI LIQUIDATION RECOMMENDED</p>
        <div className="mt-4 flex items-center gap-4">
          <div><p className="text-xs text-slate-600">Original price</p><p className="text-2xl font-semibold text-slate-500 line-through">{inr(l.originalPrice)}</p></div>
          <TrendingDown className="h-6 w-6 text-red-600" aria-label="reduced to" />
          <div><p className="text-xs text-slate-600">Recommended price</p><p className="text-4xl font-extrabold text-red-700">{inr(l.newPrice)}</p></div>
        </div>
        <p className="mt-2 text-lg font-bold text-red-700">{isNum(l.markdownPct) ? `${l.markdownPct}% MARKDOWN` : ''}</p>
        <dl className="mt-3 divide-y divide-slate-100 text-sm">
          <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Reason</dt><dd className="text-right font-medium">{l.reason || l.action || 'Shelf life below safe threshold'}</dd></div>
          <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Urgency</dt><dd className={`text-right font-medium ${urgency.cls}`}>{urgency.label}{isNum(l.sellWithinHours) ? ` (within ${l.sellWithinHours}h)` : ''}</dd></div>
          <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Estimated recovery</dt><dd className="font-medium">{inr(l.recovery)}</dd></div>
          <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Estimated loss avoided</dt><dd className="font-medium">{inr(l.lossAvoided)}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Prices are per kg.</p>
      </div>
    );
  }
  return <Card title="Liquidation recommendation" icon={TrendingDown}>{body}</Card>;
}
