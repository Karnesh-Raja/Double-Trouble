import SpikeControl from '../components/SpikeControl';
import KpiCards from '../components/KpiCards';
import BeforeAfter from '../components/BeforeAfter';
import TelemetryCharts from '../components/TelemetryCharts';
import ShipmentPanel from '../components/ShipmentPanel';
import LiquidationCard from '../components/LiquidationCard';
import AlertsPanel from '../components/AlertsPanel';
import InsightCard from '../components/InsightCard';

export default function Dashboard() {
  return (
    <div className="space-y-4">
      <SpikeControl />
      <KpiCards />
      <BeforeAfter />
      <TelemetryCharts />
      <div className="grid gap-4 lg:grid-cols-3">
        <ShipmentPanel />
        <LiquidationCard />
        <AlertsPanel />
      </div>
      <InsightCard />
    </div>
  );
}
