import { Store, Sparkles } from 'lucide-react';
import { RiskBadge } from './ui';
import { formatShelfLife, inr, isNum, riskStyle } from '../utils/format';

// Pure display. Price, discount, time left and urgency all come from the backend (GET /api/marketplace).
export default function ListingCard({ l, message }) {
  const risk = l.risk;
  const critical = risk === 'CRITICAL';
  const d = l.display;
  const urgencyText = d.urgency || l.urgencyLabel;
  return (
    <article className={`overflow-hidden rounded-lg bg-white ${critical ? 'border-2 border-red-500 shadow-md' : 'border border-slate-200'}`}>
      {critical && urgencyText && <p className="bg-red-600 px-4 py-1.5 text-xs font-bold tracking-wide text-white">{urgencyText}</p>}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold"><Store className="h-4 w-4 text-field-600" aria-hidden="true" />{d.title || l.produce}</h3>
            <p className="text-sm text-slate-600">{l.shipmentId} · {isNum(l.quantity) ? `${l.quantity} kg` : '—'}</p>
          </div>
          <RiskBadge level={risk} />
        </div>
        <div className="mt-4 flex items-end gap-3">
          <div><p className="text-xs text-slate-600">Original</p><p className="text-lg text-slate-500 line-through">{d.original || inr(l.originalPrice)}</p></div>
          <div><p className="text-xs text-slate-600">AI recommended / kg</p><p className={`text-3xl font-extrabold ${critical ? 'text-red-700' : 'text-ink'}`}>{d.recommended || inr(l.price)}</p></div>
          {(d.discount || isNum(l.pct)) && <span className={`mb-1 rounded px-2 py-0.5 text-sm font-bold ${risk ? riskStyle(risk).badge : 'bg-slate-100'}`}>{d.discount || `${l.pct}% OFF`}</span>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-slate-600">Shelf life</dt><dd className="font-semibold">{d.timeLeft || formatShelfLife(l.remainingHours)}</dd></div>
          <div><dt className="text-slate-600">Urgency</dt><dd className={`font-semibold ${riskStyle(l.urgency).text}`}>{urgencyText || '—'}</dd></div>
        </dl>
        {l.reason && <p className="mt-3 text-xs text-slate-600">{l.reason}</p>}
        {message && (
          <blockquote className="mt-3 rounded-md border-l-4 border-field-600 bg-field-50 p-3 text-sm leading-relaxed text-slate-800">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-field-700"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Message to retailers</p>
            {message}
          </blockquote>
        )}
        <p className="mt-3 text-xs text-slate-500">Listing status: {l.status}</p>
      </div>
    </article>
  );
}
