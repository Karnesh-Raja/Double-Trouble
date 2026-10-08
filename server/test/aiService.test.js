import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.LOG_LEVEL = 'silent';
const { config } = await import('../src/utils/config.js');
const { initDb, closeDb } = await import('../src/database/db.js');
const { aiCalls } = await import('../src/database/repositories.js');
const { generateInsight, PROMPT_VERSION } = await import('../src/services/aiService.js');
const { calculateShelfLife } = await import('../src/engines/shelfLifeEngine.js');
const { planLiquidation } = await import('../src/engines/liquidationEngine.js');

initDb(':memory:');
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; closeDb(); });

const shipment = { id: 'SHP-001', produceType: 'Tomatoes', origin: 'Chennai', destination: 'Bengaluru', baselineShelfLifeHours: 120, quantity: 1000, basePricePerKg: 150 };
const shelfLife = calculateShelfLife(shipment, { temperature: 12, humidity: 85, transitMinutes: 240 });
const plan = planLiquidation({ riskLevel: 'CRITICAL', remainingHours: shelfLife.remainingHours, temperature: 12, spoilageRate: shelfLife.spoilageRate, quantity: 1000, basePricePerKg: 150 });
const ctx = { shipment, telemetryId: 7, temperature: 12, humidity: 85, shelfLife, risk: shelfLife.risk, plan };

const GOOD = { summary: 'Tomatoes are at critical risk with 18h of shelf life left.', riskExplanation: 'Heat at 12 degrees C is the biggest driver, with 85% humidity and extended transit.', recommendedAction: 'Restore cooling and apply the 50% markdown at 75 per kg within 9h.', retailerMessage: 'Urgent tomato lot of 1000 kg at 75 per kg, about 18h of shelf life.', urgency: 'CRITICAL' };
const reply = (text) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) });
const http = (status) => ({ ok: false, status, json: async () => ({}) });
const mock = (...responses) => { const calls = []; globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); const r = responses[Math.min(calls.length - 1, responses.length - 1)]; if (r instanceof Error) throw r; return r; }; return calls; };

beforeEach(() => { config.ai.apiKey = 'sk-test-SECRET-123'; config.ai.maxRetries = 1; config.ai.timeoutMs = 500; });

test('no API key: skipped, deterministic fallback, still logged', async () => {
  config.ai.apiKey = '';
  const calls = mock(reply('unused'));
  const r = await generateInsight(ctx);
  assert.equal(calls.length, 0);
  assert.equal(r.status, 'skipped'); assert.equal(r.source, 'fallback-template'); assert.equal(r.insight.urgency, 'CRITICAL');
  assert.equal(aiCalls.recent(1)[0].status, 'skipped');
});

test('success: request is built server-side with versioned prompt, result validated and logged', async () => {
  const calls = mock(reply(JSON.stringify(GOOD)));
  const r = await generateInsight(ctx);
  assert.equal(r.status, 'ok'); assert.equal(r.source, 'claude'); assert.equal(r.attempts, 1); assert.equal(r.promptVersion, PROMPT_VERSION);
  assert.deepEqual(r.insight, GOOD);
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(calls[0].opts.headers['x-api-key'], 'sk-test-SECRET-123');
  assert.equal(calls[0].opts.body.includes('SECRET'), false, 'key is only in the header');
  assert.match(sent.system, /decision-support analyst/);
  assert.match(sent.messages[0].content, /"remainingShelfLifeHours":18/);
  const row = aiCalls.recent(1)[0];
  assert.deepEqual([row.status, row.success, row.promptVersion, row.model, row.shipmentId, row.telemetryId, row.attempts], ['ok', true, 'v1.0', config.ai.model, 'SHP-001', 7, 1]);
  assert.equal(typeof row.latencyMs, 'number'); assert.ok(row.timestamp);
});

test('invalid JSON then valid JSON: exactly one retry, recovers', async () => {
  const calls = mock(reply('I think the tomatoes are in trouble.'), reply(JSON.stringify(GOOD)));
  const r = await generateInsight(ctx);
  assert.equal(calls.length, 2); assert.equal(r.status, 'ok'); assert.equal(r.attempts, 2);
  const second = JSON.parse(calls[1].opts.body).messages;
  assert.equal(second.length, 3); assert.match(second[2].content, /rejected: reply was not a valid JSON object/);
  assert.equal(aiCalls.stats().recoveredByRetry >= 1, true);
});

test('invalid twice: never a third call, deterministic fallback used', async () => {
  const calls = mock(reply('nope'), reply(JSON.stringify({ ...GOOD, urgency: 'LOW' })));
  const r = await generateInsight(ctx);
  assert.equal(calls.length, 2);
  assert.equal(r.status, 'failed'); assert.equal(r.source, 'fallback-template'); assert.equal(r.failureType, 'invalid_output'); assert.equal(r.attempts, 2);
  assert.equal(r.insight.urgency, 'CRITICAL');
  assert.match(r.error, /contradicts/);
});

test('model altering the shelf-life number is rejected, not shown', async () => {
  mock(reply(JSON.stringify({ ...GOOD, summary: 'Tomatoes have about 40h left.' })));
  const r = await generateInsight(ctx);
  assert.equal(r.source, 'fallback-template'); assert.match(r.insight.summary, /18h/);
});

test('transient 500 is retried once; 401 is not retried', async () => {
  let calls = mock(http(500), reply(JSON.stringify(GOOD)));
  let r = await generateInsight(ctx);
  assert.equal(calls.length, 2); assert.equal(r.status, 'ok');
  calls = mock(http(401), reply(JSON.stringify(GOOD)));
  r = await generateInsight(ctx);
  assert.equal(calls.length, 1); assert.equal(r.status, 'failed'); assert.equal(r.failureType, 'http_error'); assert.match(r.error, /401/);
});

test('timeout: falls back without retrying (bounded wait)', async () => {
  config.ai.timeoutMs = 30;
  const calls = []; globalThis.fetch = (url, opts) => { calls.push(1); return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
  const r = await generateInsight(ctx);
  assert.equal(calls.length, 1); assert.equal(r.failureType, 'timeout'); assert.equal(r.source, 'fallback-template');
});

test('network failure never throws and never leaks the key', async () => {
  mock(new Error('connect ECONNREFUSED while sending sk-test-SECRET-123'));
  const r = await generateInsight(ctx);
  assert.equal(r.status, 'failed');
  const everything = JSON.stringify([r, aiCalls.recent(5)]);
  assert.equal(everything.includes('SECRET'), false);
});

test('telemetry stats aggregate success, failure, skipped, latency', () => {
  const s = aiCalls.stats();
  assert.ok(s.total >= 8 && s.succeeded >= 3 && s.failed >= 4 && s.skipped >= 1);
  assert.ok(s.successRatePct > 0 && s.successRatePct < 100);
  assert.equal(typeof s.avgLatencyMs, 'number');
});
