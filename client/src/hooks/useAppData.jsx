import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { normShipment, normTelemetry, normAlert, normLiquidation, normInsight, normAiTelemetry, normListing, normMarketSummary, toArray } from '../utils/normalize';

const Ctx = createContext(null);
export const useAppData = () => useContext(Ctx);
const POLL_MS = 5000;

// Single source of truth for the UI. Every value here is fetched from the backend;
// the frontend never computes shelf life, risk, price or AI text.
export function DataProvider({ children }) {
  const [online, setOnline] = useState(null);          // null = checking
  const [shipments, setShipments] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [liquidation, setLiquidation] = useState(null);
  const [insight, setInsight] = useState(null);
  const [aiTelemetry, setAiTelemetry] = useState(null);
  const [marketplace, setMarketplace] = useState(null);
  const [marketSummary, setMarketSummary] = useState(null);
  const [errors, setErrors] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [spiking, setSpiking] = useState(false);
  const [spikeError, setSpikeError] = useState(null);
  const [toasts, setToasts] = useState([]);

  const selectedRef = useRef(null);
  const inflight = useRef(false);
  const seenAlerts = useRef(null);

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.key !== id)), []);

  const refreshAll = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setRefreshing(true);
    const errs = {};
    try {
      try { await api.health(); setOnline(true); }
      catch (e) { setOnline(false); errs.health = e; setErrors(errs); return; }

      // Shipments decide which shipment the per-shipment calls target.
      let list = [];
      try {
        list = toArray(await api.shipments(), 'shipments').map(normShipment);
        setShipments(list);
        const keep = selectedRef.current && list.some((s) => s.id === selectedRef.current);
        selectedRef.current = keep ? selectedRef.current : list[0]?.id ?? null;
        setSelectedId(selectedRef.current);
      } catch (e) { errs.shipments = e; }

      const id = selectedRef.current;
      const run = async (key, fn, set) => { try { set(await fn()); } catch (e) { errs[key] = e; } };
      await Promise.all([
        id && run('telemetry', async () => toArray(await api.telemetry(id), 'telemetry').map(normTelemetry), setTelemetry),
        id && run('liquidation', async () => normLiquidation(await api.liquidation(id)), setLiquidation),
        id && run('insight', async () => normInsight(await api.insight(id)), setInsight),
        run('aiTelemetry', async () => normAiTelemetry(await api.aiTelemetry()), setAiTelemetry),
        run('alerts', async () => {
          const a = toArray(await api.alerts(), 'alerts').map(normAlert);
          if (seenAlerts.current === null) seenAlerts.current = new Set(a.map((x) => x.id));
          else {
            const fresh = a.filter((x) => !seenAlerts.current.has(x.id) && !x.read);
            fresh.forEach((x) => seenAlerts.current.add(x.id));
            if (fresh.length) setToasts((t) => [...t, ...fresh.map((x) => ({ key: `a${x.id}`, alert: x }))]);
          }
          return a;
        }, setAlerts),
        run('marketplace', async () => toArray(await api.marketplace(), 'listings').map(normListing), setMarketplace),
        run('marketSummary', async () => normMarketSummary(await api.marketplaceSummary()), setMarketSummary),
      ]);
      setLastRefresh(new Date());
    } finally {
      setErrors(errs);
      setRefreshing(false);
      inflight.current = false;
    }
  }, []);

  const selectShipment = useCallback((id) => {
    selectedRef.current = id; setSelectedId(id);
    setTelemetry(null); setLiquidation(null); setInsight(null);
    refreshAll();
  }, [refreshAll]);

  // Backend performs the whole state transition; the UI just re-reads everything afterwards.
  const triggerSpike = useCallback(async () => {
    if (!selectedRef.current) return;
    setSpiking(true); setSpikeError(null);
    try {
      await api.spike(selectedRef.current);
      inflight.current = false;
      await refreshAll();
    } catch (e) { setSpikeError(e); }
    finally { setSpiking(false); }
  }, [refreshAll]);

  const markAlertRead = useCallback(async (id) => {
    try { await api.markAlertRead(id); await refreshAll(); } catch (e) { setErrors((x) => ({ ...x, alerts: e })); }
  }, [refreshAll]);

  useEffect(() => {
    refreshAll();
    const t = setInterval(() => { if (!document.hidden) refreshAll(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refreshAll]);

  const shipment = useMemo(() => shipments?.find((s) => s.id === selectedId) ?? null, [shipments, selectedId]);

  const value = {
    online, shipments, shipment, selectedId, telemetry, alerts, liquidation, insight, aiTelemetry, marketplace, marketSummary,
    errors, refreshing, lastRefresh, spiking, spikeError, toasts,
    refreshAll, selectShipment, triggerSpike, markAlertRead, dismissToast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
