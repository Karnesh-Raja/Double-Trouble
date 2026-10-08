import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import { Card, EmptyState, ErrorState, Skeleton } from './ui';

const TEMP_LIMIT = 8;       // cold-chain limit used by the backend risk engine
const CRITICAL_HOURS = 24;  // critical threshold used by the backend risk engine

function Chart({ title, unit, dataKey, data, color, limit, limitLabel, dotFn, summary }) {
  return (
    <figure aria-label={title} className="m-0">
      <figcaption className="mb-2 text-sm font-semibold text-slate-800">{title}</figcaption>
      <p className="sr-only">{summary}</p>
      <div className="h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} unit={unit} domain={[0, 'auto']} width={48} />
            <Tooltip formatter={(v) => [`${v}${unit}`, title]} />
            {limit != null && <ReferenceLine y={limit} stroke="#dc2626" strokeDasharray="5 4" label={{ value: limitLabel, fontSize: 11, fill: '#b91c1c', position: 'insideTopRight' }} />}
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={dotFn || { r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export default function TelemetryCharts() {
  const { telemetry, errors, refreshAll } = useAppData();
  let body;
  if (errors.telemetry) body = <ErrorState title="Telemetry unavailable" error={errors.telemetry} onRetry={refreshAll} />;
  else if (telemetry === null) body = <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>;
  else if (!telemetry.length) body = <EmptyState title="No telemetry yet" hint="Charts appear after the first reading is stored." />;
  else {
    const last = telemetry[telemetry.length - 1];
    // Points above the limit render as larger red dots so the spike is obvious.
    const tempDot = ({ cx, cy, payload }) => payload.temperature > TEMP_LIMIT
      ? <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={6} fill="#dc2626" stroke="#fff" strokeWidth={2} />
      : <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} fill="#1F6F4A" />;
    body = (
      <div className="grid gap-6 lg:grid-cols-3">
        <Chart title="Temperature vs time" unit="°C" dataKey="temperature" data={telemetry} color="#1F6F4A" limit={TEMP_LIMIT} limitLabel="8°C limit" dotFn={tempDot}
          summary={`${telemetry.length} readings, latest ${last.temperature} degrees Celsius.`} />
        <Chart title="Humidity vs time" unit="%" dataKey="humidity" data={telemetry} color="#2563eb"
          summary={`Latest humidity ${last.humidity} percent.`} />
        <Chart title="Shelf life vs time" unit="h" dataKey="remainingHours" data={telemetry} color="#ea580c" limit={CRITICAL_HOURS} limitLabel="24h critical"
          summary={`Latest remaining shelf life ${last.remainingHours} hours.`} />
      </div>
    );
  }
  return <Card title="Telemetry" icon={Activity}>{body}</Card>;
}
