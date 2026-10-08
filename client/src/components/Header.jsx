import { NavLink } from 'react-router-dom';
import { RefreshCw, Wifi, WifiOff, Truck } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { timeLabel } from '../utils/format';

const link = ({ isActive }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/15 text-white' : 'text-emerald-100 hover:bg-white/10'}`;

export default function Header() {
  const { online, shipments, selectedId, selectShipment, telemetry, lastRefresh, refreshing, refreshAll } = useAppData();
  const latest = telemetry?.length ? telemetry[telemetry.length - 1] : null;
  return (
    <header className="bg-ink text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div>
          <p className="text-xl font-bold tracking-wide">AGROSENSE</p>
          <p className="text-xs text-emerald-200">AI-Powered Cold-Chain Intelligence</p>
        </div>
        <nav aria-label="Primary" className="flex gap-1">
          <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
          <NavLink to="/marketplace" className={link}>Marketplace</NavLink>
        </nav>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-emerald-100">
          <span role="status" className="inline-flex items-center gap-1.5 font-medium">
            {online === false ? <WifiOff className="h-4 w-4 text-red-400" aria-hidden="true" /> : <Wifi className={`h-4 w-4 ${online ? 'text-emerald-400' : 'text-slate-400'}`} aria-hidden="true" />}
            System {online === null ? 'checking…' : online ? 'online' : 'offline'}
          </span>
          <label className="inline-flex items-center gap-1.5">
            <Truck className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Current shipment</span>
            <select value={selectedId || ''} onChange={(e) => selectShipment(e.target.value)} disabled={!shipments?.length}
              className="rounded bg-white/10 px-2 py-1 text-white [&>option]:text-ink">
              {!shipments?.length && <option value="">No shipments</option>}
              {shipments?.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.produce}</option>)}
            </select>
          </label>
          <span>Last telemetry: <strong className="text-white">{timeLabel(latest?.time)}</strong></span>
          <button onClick={refreshAll} aria-label="Refresh data now" className="inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/10">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : `Updated ${timeLabel(lastRefresh)}`}
          </button>
        </div>
      </div>
    </header>
  );
}
