import { Package, Thermometer, Droplets, Clock, ShieldAlert, IndianRupee } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { Skeleton, RiskBadge } from './ui';
import { formatShelfLife, inr, isNum, riskStyle } from '../utils/format';

function Kpi({ label, icon: Icon, loading, children, tone }) {
  return (
    <div className={`rounded-lg border p-4 ${tone || 'border-slate-200 bg-white'}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><Icon className="h-4 w-4" aria-hidden="true" />{label}</p>
      <div className="mt-2 min-h-[2rem] text-2xl font-bold">{loading ? <Skeleton className="h-8 w-24" /> : children}</div>
    </div>
  );
}

export default function KpiCards() {
  const { shipments, shipment, telemetry, liquidation } = useAppData();
  const latest = telemetry?.length ? telemetry[telemetry.length - 1] : null;
  const loading = shipments === null;
  const active = shipments?.filter((s) => s.status !== 'DELIVERED').length;
  const risk = shipment?.riskLevel || latest?.riskLevel;
  const hours = isNum(shipment?.remainingHours) ? shipment.remainingHours : latest?.remainingHours;
  const dash = <span className="text-slate-400">—</span>;
  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Active shipments" icon={Package} loading={loading}>{isNum(active) ? active : dash}</Kpi>
      <Kpi label="Current temperature" icon={Thermometer} loading={telemetry === null && !loading}
        tone={latest?.temperature > 8 ? 'border-red-300 bg-red-50' : undefined}>
        {isNum(latest?.temperature) ? `${latest.temperature}°C` : dash}
      </Kpi>
      <Kpi label="Humidity" icon={Droplets} loading={telemetry === null && !loading}>{isNum(latest?.humidity) ? `${latest.humidity}%` : dash}</Kpi>
      <Kpi label="Remaining shelf life" icon={Clock} loading={loading} tone={risk ? riskStyle(risk).panel : undefined}>{formatShelfLife(hours)}</Kpi>
      <Kpi label="Spoilage risk" icon={ShieldAlert} loading={loading}>{risk ? <RiskBadge level={risk} size="lg" /> : dash}</Kpi>
      <Kpi label="Est. loss avoided" icon={IndianRupee} loading={loading}>{liquidation?.required && isNum(liquidation.lossAvoided) ? inr(liquidation.lossAvoided) : dash}</Kpi>
    </section>
  );
}
