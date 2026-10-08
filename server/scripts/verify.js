// In-process verification of the full pipeline (controllers -> services -> engines -> SQLite file).
// Needs no network and no Express: it drives the same controller functions the routes call.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agrosense-')), 'verify.db');
process.env.DB_PATH = dbFile;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.ANTHROPIC_API_KEY = '';

const { config } = await import('../src/utils/config.js');
const { initDb, closeDb } = await import('../src/database/db.js');
const c = await import('../src/controllers/index.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { seedDemo } = await import('../src/services/seedService.js');
initDb();

let failed = 0;
const check = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

async function call(handler, { params = {}, body, query = {} } = {}) {
  const res = { statusCode: 200, locals: {}, headersSent: false, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } };
  const req = { params, body, query, method: 'TEST', path: '/test' };
  try { await handler(req, res); } catch (err) { res.headersSent = false; errorHandler(err, req, res, () => {}); }
  return { status: res.statusCode, body: res.body };
}

console.log('\n== 1. Health + seed ==');
let r = await call(c.health);
check('GET /api/health -> 200, db ok, no secrets', r.status === 200 && r.body.database === 'ok' && !JSON.stringify(r.body).includes('apiKey'));
await seedDemo();
r = await call(c.listShipments);
const s0 = r.body[0];
check('SHP-001 seeded and LOW', r.body.length === 1 && s0.id === 'SHP-001' && s0.riskLevel === 'LOW', `${s0.remainingHours}h`);
check('NORMAL: 120h = 5 days, LOW', s0.remainingHours === 120);

console.log('\n== 2. Validation ==');
const bad = async (name, body, status) => { const x = await call(c.postTelemetry, { body }); check(name, x.status === status && x.body.error && !JSON.stringify(x.body).includes('at '), `${x.status} ${x.body.code}`); };
await bad('missing shipmentId -> 400', { temperature: 4, humidity: 78, transitMinutes: 180 }, 400);
await bad('invalid temperature -> 400', { shipmentId: 'SHP-001', temperature: 'hot', humidity: 78, transitMinutes: 180 }, 400);
await bad('temperature out of range -> 400', { shipmentId: 'SHP-001', temperature: 500, humidity: 78, transitMinutes: 180 }, 400);
await bad('invalid humidity -> 400', { shipmentId: 'SHP-001', temperature: 4, humidity: 150, transitMinutes: 180 }, 400);
await bad('invalid transit -> 400', { shipmentId: 'SHP-001', temperature: 4, humidity: 78, transitMinutes: -5 }, 400);
await bad('unknown shipment -> 404', { shipmentId: 'NOPE-9', temperature: 4, humidity: 78, transitMinutes: 180 }, 404);
r = await call(c.simulateSpike, { params: { shipmentId: 'NOPE-9' } });
check('spike on unknown shipment -> 404', r.status === 404);
r = await call(c.simulateSpike, { params: { shipmentId: "SHP-001'; DROP TABLE shipments;--" } });
check('SQL-injection-shaped id rejected -> 400', r.status === 400);
r = await call((q, s) => { throw new Error('secret internal detail at /srv/app.js:42'); });
check('unexpected error -> generic 500, nothing leaked', r.status === 500 && r.body.error === 'Internal server error' && !JSON.stringify(r.body).includes('secret'));

console.log('\n== 3. THE DEMO: POST /api/simulate/temperature-spike/SHP-001 ==');
r = await call(c.simulateSpike, { params: { shipmentId: 'SHP-001' } });
const b = r.body;
check('201 returned', r.status === 201);
check('telemetry persisted (12C / 85% / 240min)', b.latestTelemetry.temperature === 12 && b.latestTelemetry.humidity === 85 && b.latestTelemetry.transitMinutes === 240 && b.counts.telemetry === 2);
check('shelf life recalculated by the model: 18h', b.shelfLife.remainingHours === 18 && b.shelfLife.degradationPercentage === 85, b.shelfLife.formula);
check('explainable factors + contributions returned', b.shelfLife.factors.join(',') === 'Elevated temperature exposure,High humidity,Extended transit duration' && b.shelfLife.contributions.temperatureStress === 5.2);
check('risk updated to CRITICAL', b.shipment.riskLevel === 'CRITICAL' && b.transition.previousRisk === 'LOW');
check('liquidation generated (Rs150 -> Rs75, 50%)', b.liquidation.markdownPct === 50 && b.liquidation.originalPricePerKg === 150 && b.liquidation.markdownPricePerKg === 75, `recovery ${b.liquidation.estimatedRecovery}`);
check('alert generated', b.newAlert && b.newAlert.severity === 'CRITICAL' && /18 hours/.test(b.newAlert.message), b.newAlert?.message);
check('marketplace listing OPEN + retailers notified', b.marketplaceListing?.status === 'OPEN' && b.marketplaceListing.retailerNotified === true);
check('AI step ran (no key -> fallback, recorded)', b.pipeline.find((s) => s.step === 'ai').status === 'skipped' && b.aiInsight?.source === 'fallback-template' && b.aiInsight.insight.urgency === 'CRITICAL' && /18h/.test(b.aiInsight.insight.riskExplanation) && /critical spoilage risk/.test(b.aiInsight.insight.summary));
check('fallback insight has all 5 spec fields + prompt version stored', ['summary', 'riskExplanation', 'recommendedAction', 'retailerMessage', 'urgency'].every((k) => b.aiInsight.insight[k]) && b.aiInsight.promptVersion === 'v1.0');
console.log('      pipeline:', b.pipeline.map((s) => `${s.step}:${s.status}`).join(' | '));

console.log('\n== 4. AI success path (mocked provider) + failure path ==');
config.ai.apiKey = 'test-key-not-real';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const sent = JSON.parse(opts.body);
  check('AI request is server-side, key in header only, facts only', opts.headers['x-api-key'] === 'test-key-not-real' && !opts.body.includes('test-key') && sent.messages[0].content.includes('"temperature":12') && /shipment_data/.test(sent.messages[0].content) && /decision-support analyst/.test(sent.system));
  const reply = { summary: 'Tomatoes are at critical risk with 18h of shelf life left.', riskExplanation: 'Heat at 12C is the main driver, with 85% humidity and long transit.', recommendedAction: 'Mark down 50%.', retailerMessage: 'Urgent tomato lot, 1000 kg at 75 per kg, 18h of shelf life.', urgency: 'CRITICAL' };
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
};
r = await call(c.simulateSpike, { params: { shipmentId: 'SHP-001' } });
check('AI success: source=claude, 5 fields stored with prompt version', r.body.aiInsight.source === 'claude' && r.body.aiInsight.insight.recommendedAction === 'Mark down 50%.' && r.body.aiInsight.insight.urgency === 'CRITICAL' && r.body.aiInsight.promptVersion === 'v1.0' && r.body.aiInsight.attempts === 1 && Number.isFinite(r.body.aiInsight.latencyMs));
check('repeat spike: NO duplicate alert / listing / liquidation', r.body.newAlert === null && r.body.alerts.length === 1 && r.body.counts.liquidations === 1 && (await call(c.getMarketplace)).body.length === 1);
globalThis.fetch = async () => { throw new Error('network down'); };
r = await call(c.simulateSpike, { params: { shipmentId: 'SHP-001' } });
check('AI failure: request still 201, fallback stored, error recorded', r.status === 201 && r.body.aiInsight.source === 'fallback-template' && /network down/.test(r.body.aiInsight.error) && r.body.aiInsight.failureType === 'network' && r.body.counts.telemetry === 4);
globalThis.fetch = realFetch; config.ai.apiKey = '';
r = await call(c.getAiTelemetry);
check('GET ai-telemetry: stats + recent calls, prompt version, no secrets', r.status === 200 && r.body.promptVersion === 'v1.0' && r.body.stats.succeeded === 1 && r.body.stats.failed === 1 && r.body.stats.skipped === 1 && r.body.recent[0].success === false && r.body.recent[0].promptVersion === 'v1.0' && !/test-key/.test(JSON.stringify(r.body)), JSON.stringify(r.body.stats));

console.log('\n== 5. Frontend contract endpoints ==');
r = await call(c.getTelemetry, { params: { shipmentId: 'SHP-001' } });
check('GET telemetry: oldest-first array', r.body.length === 4 && r.body[0].temperature === 4 && r.body[3].temperature === 12);
r = await call(c.listAlerts);
const alertId = r.body[0].id;
check('GET alerts: 1 unread', r.body.length === 1 && r.body[0].isRead === false);
r = await call(c.readAlert, { params: { id: String(alertId) } });
check('PATCH alert read persists', r.body.isRead === true && (await call(c.listAlerts, { query: { unread: 'true' } })).body.length === 0);
check('PATCH bad / unknown alert id -> 400 / 404', (await call(c.readAlert, { params: { id: 'x' } })).status === 400 && (await call(c.readAlert, { params: { id: '999' } })).status === 404);
r = await call(c.getLiquidation, { params: { shipmentId: 'SHP-001' } });
check('GET liquidation', r.status === 200 && r.body.markdownPricePerKg === 75 && r.body.estimatedLossAvoided === 60000);
r = await call(c.getInsight, { params: { shipmentId: 'SHP-001' } });
check('GET ai-insights', r.status === 200 && ['summary', 'riskExplanation', 'recommendedAction', 'retailerMessage', 'urgency'].every((k) => r.body.insight[k]));
r = await call(c.getShipment, { params: { id: 'SHP-001' } });
check('GET shipments/:id full state', r.body.shipment.riskLevel === 'CRITICAL' && r.body.marketplaceListing && r.body.liquidation && r.body.aiInsight);

console.log('\n== 5b. Marketplace API + liquidation bands ==');
r = await call(c.getMarketplace);
const lot = r.body[0] || {};
check('GET marketplace: spec fields', r.status === 200 && r.body.length === 1 && lot.shipmentId === 'SHP-001' && lot.produce === 'Tomatoes' && lot.quantity === 1000 && lot.originalPrice === 150 && lot.discount === 50 && lot.recommendedPrice === 75 && lot.remainingShelfLifeHours === 18 && lot.risk === 'CRITICAL' && lot.urgency === 'CRITICAL', JSON.stringify({ d: lot.discount, p: lot.recommendedPrice }));
check('GET marketplace: ready-to-render display strings', lot.display?.title === 'TOMATOES' && lot.display.original === '₹150' && lot.display.recommended === '₹75' && lot.display.discount === '50% OFF' && lot.display.timeLeft === '18 HOURS LEFT' && lot.display.urgency === 'URGENT LIQUIDATION');
r = await call(c.getMarketplaceSummary);
check('GET marketplace/summary: estimated loss avoided', r.status === 200 && r.body.activeListings === 1 && r.body.potentialLoss === 150000 && r.body.estimatedLossAvoided === 60000 && r.body.residualLoss === 90000 && r.body.display.lossAvoided === '₹60,000', JSON.stringify(r.body.display));
check('GET marketplace/:shipmentId -> 200; unknown -> 404; bad id -> 400', (await call(c.getMarketplaceListing, { params: { shipmentId: 'SHP-001' } })).status === 200 && (await call(c.getMarketplaceListing, { params: { shipmentId: 'NOPE-9' } })).status === 404 && (await call(c.getMarketplaceListing, { params: { shipmentId: 'a b' } })).status === 400);
r = await call(c.postTelemetry, { body: { shipmentId: 'SHP-001', temperature: 15, humidity: 85, transitMinutes: 240 } });
check('10.8h -> CLEARANCE band: 70% = Rs45, listing re-priced and a new alert, with no manual step', r.status === 201 && r.body.marketplaceListing.discount === 70 && r.body.marketplaceListing.recommendedPrice === 45 && r.body.marketplaceListing.display.timeLeft === '11 HOURS LEFT' && r.body.newAlert?.severity === 'CRITICAL' && /70% markdown/.test(r.body.newAlert.message) && r.body.counts.liquidations === 2, r.body.newAlert?.message);
r = await call(c.getLiquidationHistory, { params: { shipmentId: 'SHP-001' } });
check('every distinct recommendation persisted (50% then 70%)', r.status === 200 && r.body.map((x) => x.discountPercentage).join(',') === '50,70' && r.body[1].recommendedPrice === 45);
check('liquidation history for unknown shipment -> 404', (await call(c.getLiquidationHistory, { params: { shipmentId: 'NOPE-9' } })).status === 404);

console.log('\n== 6. Custom telemetry -> de-escalation (no new alert, re-priced) ==');
r = await call(c.postTelemetry, { body: { shipmentId: 'SHP-001', temperature: 9, humidity: 78, transitMinutes: 600 } });
check('9C/10h transit -> HIGH, 25% markdown, listing re-priced, no alert', r.status === 201 && r.body.shipment.riskLevel === 'HIGH' && r.body.marketplaceListing.markdownPct === 25 && r.body.newAlert === null, `${r.body.shelfLife.remainingHours}h`);

console.log('\n== 7. Reset to NORMAL ==');
r = await call(c.simulateNormal, { params: { shipmentId: 'SHP-001' } });
check('back to LOW, listing withdrawn, liquidation/insight 404', r.body.shipment.riskLevel === 'LOW' && r.body.marketplaceListing === null && (await call(c.getLiquidation, { params: { shipmentId: 'SHP-001' } })).status === 404 && (await call(c.getMarketplace)).body.length === 0);

console.log('\n== 8. Shipments API ==');
r = await call(c.postShipment, { body: { produceType: 'Mangoes', origin: 'Salem', destination: 'Hyderabad', baselineShelfLifeHours: 200, quantity: 500, basePricePerKg: 80 } });
check('POST shipment -> 201, auto id SHP-002', r.status === 201 && r.body.id === 'SHP-002');
check('duplicate id -> 409', (await call(c.postShipment, { body: { shipmentId: 'SHP-002', produceType: 'x', origin: 'a', destination: 'b', baselineShelfLifeHours: 10, quantity: 1 } })).status === 409);
check('invalid shipment -> 400', (await call(c.postShipment, { body: { produceType: '', quantity: -1 } })).status === 400);
r = await call(c.simulateSpike, { params: { shipmentId: 'SHP-002' } });
check('SHP-002 (mangoes, 200h baseline, Rs80): same spike -> 35.7h = HIGH, 25% markdown -> Rs60', r.body.shelfLife.remainingHours === 35.7 && r.body.shelfLife.model.produceProfile === 'mangoes' && r.body.shipment.riskLevel === 'HIGH' && r.body.liquidation.markdownPricePerKg === 60 && r.body.newAlert.severity === 'HIGH', `${r.body.shelfLife.remainingHours}h`);

console.log('\n== 9. Persistence survives a process restart ==');
closeDb();
const out = execFileSync(process.execPath, ['--no-warnings', '-e', `
  const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(${JSON.stringify(dbFile)});
  const n=(t)=>d.prepare('SELECT COUNT(*) n FROM '+t).get().n;
  console.log(JSON.stringify({telemetry:n('telemetry'),alerts:n('alerts'),liquidations:n('liquidations'),listings:n('marketplace_listings'),insights:n('ai_insights'),risk:d.prepare("SELECT risk_level r FROM shipments WHERE id='SHP-002'").get().r}))`]).toString();
const p = JSON.parse(out);
check('fresh process reads all state from disk', p.telemetry >= 6 && p.alerts === 3 && p.liquidations >= 3 && p.insights >= 4 && p.risk === 'HIGH', out.trim());

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
