import { useEffect } from 'react';
import { AlertOctagon, X } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { riskStyle } from '../utils/format';

function Toast({ t, onClose }) {
  useEffect(() => { const id = setTimeout(onClose, 10000); return () => clearTimeout(id); }, [onClose]);
  const sev = t.alert.severity;
  const s = riskStyle(sev);
  return (
    <div role="alert" className={`flex w-full max-w-sm gap-3 rounded-lg border-l-4 bg-white p-4 shadow-lg ring-1 ring-slate-200 ${sev === 'CRITICAL' ? 'border-red-600' : 'border-orange-500'}`}>
      <AlertOctagon className={`mt-0.5 h-5 w-5 shrink-0 ${s.text}`} aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className={`font-bold ${s.text}`}>{sev} SPOILAGE ALERT</p>
        <p className="mt-1 text-slate-800">{t.alert.message}</p>
        <p className="mt-1 text-xs text-slate-500">Retailer liquidation recommendation generated.</p>
      </div>
      <button onClick={onClose} aria-label="Dismiss alert" className="self-start rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" aria-hidden="true" /></button>
    </div>
  );
}

export default function Toasts() {
  const { toasts, dismissToast } = useAppData();
  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-end gap-2 px-4">
      {toasts.map((t) => <div key={t.key} className="pointer-events-auto w-full max-w-sm"><Toast t={t} onClose={() => dismissToast(t.key)} /></div>)}
    </div>
  );
}
