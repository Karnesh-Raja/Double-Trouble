// HTTP smoke test against a RUNNING server:  npm start  (other terminal)  npm run smoke
const BASE = process.env.API_BASE || 'http://localhost:4000';
const id = process.env.SHIPMENT_ID || 'SHP-001';
const j = async (path, opts) => { const r = await fetch(BASE + path, opts); return { status: r.status, body: await r.json().catch(() => null) }; };

console.log('health      ', (await j('/api/health')).body);
await j(`/api/simulate/normal/${id}`, { method: 'POST' });
const before = (await j(`/api/shipments/${id}`)).body.shipment;
console.log('BEFORE      ', before.riskLevel, before.remainingHours + 'h');
const spike = await j(`/api/simulate/temperature-spike/${id}`, { method: 'POST' });
console.log('SPIKE       ', spike.status, spike.body.pipeline?.map((s) => `${s.step}:${s.status}`).join(' | '));
const after = (await j(`/api/shipments/${id}`)).body;
console.log('AFTER       ', after.shipment.riskLevel, after.shipment.remainingHours + 'h', '| markdown', after.liquidation?.markdownPct + '%', '| AI:', after.aiInsight?.source);
for (const p of ['alerts', `telemetry/${id}`, 'marketplace']) console.log(p.padEnd(12), (await j('/api/' + p)).body.length, 'rows');
