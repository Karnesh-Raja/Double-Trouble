import { Package } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { Card, ErrorState, EmptyState, RiskBadge, Skeleton } from './ui';
import { formatDuration, formatShelfLife, isNum } from '../utils/format';

export default function ShipmentPanel() {
  const { shipments, shipment, telemetry, errors, refreshAll } = useAppData();
  const latest = telemetry?.length ? telemetry[telemetry.length - 1] : null;
  let body;
  if (errors.shipments) body = <ErrorState title="Shipments unavailable" error={errors.shipments} onRetry={refreshAll} />;
  else if (shipments === null) body = <div className="space-y-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>;
  else if (!shipment) body = <EmptyState title="No shipments yet" hint="Create one with POST /api/shipments." />;
  else {
    const hours = isNum(shipment.remainingHours) ? shipment.remainingHours : latest?.remainingHours;
    const rows = [
      ['Shipment ID', shipment.id], ['Produce', shipment.produce],
      ['Quantity', isNum(shipment.quantity) ? `${shipment.quantity} kg` : '—'],
      ['Route', `${shipment.origin || '—'} to ${shipment.destination || '—'}`],
      ['Transit duration', formatDuration(latest?.transitMinutes)],
      ['Temperature', isNum(latest?.temperature) ? `${latest.temperature}°C` : '—'],
      ['Humidity', isNum(latest?.humidity) ? `${latest.humidity}%` : '—'],
      ['Remaining shelf life', formatShelfLife(hours)],
    ];
    body = (
      <dl className="divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-slate-600">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        <div className="flex items-center justify-between gap-4 py-2"><dt className="text-slate-600">Risk level</dt><dd><RiskBadge level={shipment.riskLevel || latest?.riskLevel} /></dd></div>
      </dl>
    );
  }
  return <Card title="Shipment" icon={Package}>{body}</Card>;
}
