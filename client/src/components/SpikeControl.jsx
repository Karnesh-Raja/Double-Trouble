import { Flame, Loader2 } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { ErrorState } from './ui';

// The button only POSTs. The backend computes shelf life, risk, liquidation, alert and marketplace listing.
export default function SpikeControl() {
  const { shipment, triggerSpike, spiking, spikeError } = useAppData();
  return (
    <section aria-label="Demo control" className="rounded-lg border-2 border-dashed border-red-300 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Demo control</h2>
          <p className="text-sm text-slate-600">Sends a simulated 12°C reading to the backend for {shipment?.id || 'the selected shipment'}. The server recomputes shelf life and risk, then creates the liquidation plan, alert and marketplace listing.</p>
        </div>
        <button onClick={triggerSpike} disabled={!shipment || spiking} aria-busy={spiking}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-base font-bold tracking-wide text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
          {spiking ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Flame className="h-5 w-5" aria-hidden="true" />}
          {spiking ? 'SENDING TO BACKEND…' : 'SIMULATE TEMPERATURE SPIKE'}
        </button>
      </div>
      {spikeError && <div className="mt-3"><ErrorState title="Temperature spike failed" error={spikeError} onRetry={triggerSpike} /></div>}
    </section>
  );
}
