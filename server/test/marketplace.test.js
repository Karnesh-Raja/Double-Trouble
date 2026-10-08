import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.LOG_LEVEL = 'silent';
process.env.AI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { initDb, closeDb, getDb } = await import('../src/database/db.js');
const { liquidations, alerts, marketplace, shipments } = await import('../src/database/repositories.js');
const { createShipment } = await import('../src/services/shipmentService.js');
const { processTelemetry } = await import('../src/services/telemetryService.js');
const market = await import('../src/services/marketplaceService.js');
const c = await import('../src/controllers/index.js');

after(() => closeDb());
beforeEach(() => { closeDb(); initDb(':memory:'); }); // fresh database per test

const ship = (over = {}) => createShipment({ shipmentId: 'SHP-001', produceType: 'Tomatoes', origin: 'Chennai', destination: 'Bengaluru', baselineShelfLifeHours: 120, quantity: 1000, basePricePerKg: 150, ...over });
const NORMAL = { temperature: 4, humidity: 78, transitMinutes: 180 };   // 120h  LOW
const SPIKE = { temperature: 12, humidity: 85, transitMinutes: 240 };   // 18h   CRITICAL, 50%
const HOTTER = { temperature: 15, humidity: 85, transitMinutes: 240 };  // 10.8h CRITICAL, 70%
const WARM = { temperature: 9, humidity: 78, transitMinutes: 600 };     // 32.4h HIGH, 25%
const send = (shipmentId, reading) => processTelemetry({ shipmentId, ...reading });
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status ?? e.name; } };

test('normal shelf life: no recommendation, no listing, no alert, empty marketplace', async () => {
  ship();
  const r = await send('SHP-001', NORMAL);
  assert.equal(r.shipment.riskLevel, 'LOW');
  assert.equal(r.liquidation, null);
  assert.equal(r.marketplaceListing, null);
  assert.equal(r.newAlert, null);
  assert.equal(liquidations.count('SHP-001'), 0);
  assert.deepEqual(market.listMarketplace(), []);
  assert.equal(market.getSummary().activeListings, 0);
  assert.equal(market.getSummary().estimatedLossAvoided, 0);
});

test('critical degradation: recommendation saved, listing priced by the backend, alert generated', async () => {
  ship();
  await send('SHP-001', NORMAL);
  const r = await send('SHP-001', SPIKE);

  // 1. recommendation updated
  assert.equal(r.liquidation.discountPercentage, 50);
  assert.equal(r.liquidation.recommendedPrice, 75);
  assert.equal(r.liquidation.urgency, 'CRITICAL');
  assert.equal(r.liquidation.reason, 'Remaining shelf life is below 24 hours.');

  // 2. saved in the database (read straight from SQL, not from the response)
  const row = getDb().prepare('SELECT * FROM liquidations WHERE shipment_id = ?').get('SHP-001');
  assert.equal(JSON.parse(row.plan_json).recommendedPrice, 75);
  assert.equal(row.telemetry_id, r.latestTelemetry.id);

  // 3. marketplace reflects the new price, linked to that recommendation
  const lot = market.listMarketplace()[0];
  assert.equal(lot.recommendedPrice, 75);
  assert.equal(lot.liquidationId, row.id);
  assert.equal(getDb().prepare('SELECT price_per_kg FROM marketplace_listings WHERE shipment_id = ?').get('SHP-001').price_per_kg, 75);

  // 4. alert generated, and it states the price
  assert.equal(r.newAlert.severity, 'CRITICAL');
  assert.match(r.newAlert.message, /18 hours/);
  assert.match(r.newAlert.message, /50% markdown \(150 to 75 per kg\)/);
});

test('GET /api/marketplace listing carries every required field and the UI display strings', async () => {
  ship();
  await send('SHP-001', SPIKE);
  const [l] = market.listMarketplace();
  assert.equal(l.shipmentId, 'SHP-001');
  assert.equal(l.produce, 'Tomatoes');
  assert.equal(l.quantity, 1000);
  assert.equal(l.originalPrice, 150);
  assert.equal(l.discount, 50);
  assert.equal(l.recommendedPrice, 75);
  assert.equal(l.remainingShelfLifeHours, 18);
  assert.equal(l.risk, 'CRITICAL');
  assert.equal(l.urgency, 'CRITICAL');
  assert.equal(l.status, 'OPEN');
  assert.deepEqual(l.display, { title: 'TOMATOES', original: '₹150', recommended: '₹75', discount: '50% OFF', timeLeft: '18 HOURS LEFT', risk: 'CRITICAL', urgency: 'URGENT LIQUIDATION', unitLabel: 'per kg' });
  assert.deepEqual(l.value, { potentialLoss: 150000, estimatedRecovery: 75000, estimatedLossAvoided: 60000, residualLoss: 90000, sellThroughRate: 0.8 });
  assert.equal(l.pricePerKg, 75); // backward-compatible alias from the first contract
});

test('automatic update: deeper degradation re-prices the SAME listing, saves a new recommendation, and alerts', async () => {
  ship();
  await send('SHP-001', SPIKE);
  const listingId = market.listMarketplace()[0].id;
  const r = await send('SHP-001', HOTTER); // still CRITICAL, but < 12h

  assert.equal(r.transition.escalated, false); // risk level did not change...
  assert.equal(r.liquidation.discountPercentage, 70); // ...the discount did
  const lots = market.listMarketplace();
  assert.equal(lots.length, 1);
  assert.equal(lots[0].id, listingId);
  assert.equal(lots[0].recommendedPrice, 45);
  assert.equal(lots[0].display.timeLeft, '11 HOURS LEFT');
  assert.equal(lots[0].band, 'CLEARANCE');
  assert.ok(r.newAlert, 'a deeper discount raises an alert');
  assert.match(r.newAlert.message, /70% markdown/);
  assert.equal(alerts.count(), 2);
  assert.deepEqual(liquidations.history('SHP-001').map((x) => x.discountPercentage), [50, 70]);
  assert.equal(marketplace.findOpen('SHP-001').liquidationId, liquidations.latest('SHP-001').id);
});

test('an identical repeat reading does not duplicate the recommendation or the alert', async () => {
  ship();
  await send('SHP-001', SPIKE);
  const r = await send('SHP-001', SPIKE);
  assert.equal(r.newAlert, null);
  assert.equal(liquidations.count('SHP-001'), 1);
  assert.equal(alerts.count(), 1);
  assert.equal(market.listMarketplace().length, 1);
});

test('medium and high urgency use the 10% and 25% bands end to end', async () => {
  ship();
  const high = await send('SHP-001', WARM);
  assert.equal(high.shipment.riskLevel, 'HIGH');
  assert.equal(high.marketplaceListing.discount, 25);
  assert.equal(high.marketplaceListing.recommendedPrice, 112.5);
  assert.equal(high.marketplaceListing.display.urgency, 'PRIORITY SALE');
  assert.equal(high.marketplaceListing.display.recommended, '₹112.50');

  ship({ shipmentId: 'SHP-002' });
  const medium = await send('SHP-002', { temperature: 6, humidity: 78, transitMinutes: 300 }); // 60h
  assert.equal(medium.shipment.riskLevel, 'MEDIUM');
  assert.equal(medium.latestTelemetry.remainingHours, 60);
  assert.equal(medium.marketplaceListing.discount, 10);
  assert.equal(medium.marketplaceListing.recommendedPrice, 135);
  assert.equal(medium.newAlert.severity, 'MEDIUM');
});

test('recovery to LOW withdraws the listing; it only shows with ?status=all and is no longer urgent', async () => {
  ship();
  await send('SHP-001', SPIKE);
  await send('SHP-001', NORMAL);
  assert.deepEqual(market.listMarketplace(), []);
  const all = market.listMarketplace({ includeAll: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'WITHDRAWN');
  assert.equal(all[0].urgency, 'LOW');
  assert.equal(all[0].display.urgency, null);
  assert.equal(liquidations.count('SHP-001'), 1); // history is kept
});

test('lots are listed most urgent first and the summary adds up', async () => {
  ship();
  ship({ shipmentId: 'SHP-002', produceType: 'Mangoes', baselineShelfLifeHours: 200, quantity: 500, basePricePerKg: 80 });
  await send('SHP-002', { temperature: 12, humidity: 85, transitMinutes: 240 }); // 35.7h HIGH, 25% -> Rs60
  await send('SHP-001', SPIKE);                                                  // 18h CRITICAL, 50% -> Rs75
  const lots = market.listMarketplace();
  assert.deepEqual(lots.map((l) => l.shipmentId), ['SHP-001', 'SHP-002']);

  const s = market.getSummary();
  assert.equal(s.activeListings, 2);
  assert.equal(s.totalQuantityKg, 1500);
  assert.equal(s.potentialLoss, 150000 + 40000);
  assert.equal(s.estimatedRecovery, 75000 + 30000);
  assert.equal(s.estimatedLossAvoided, 60000 + 24000);
  assert.equal(s.residualLoss, s.potentialLoss - s.estimatedLossAvoided);
  assert.deepEqual(s.byUrgency, { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 1 });
  assert.equal(s.mostUrgentShipmentId, 'SHP-001');
  assert.equal(s.display.lossAvoided, '₹84,000');
});

test('missing shipment: 404 everywhere, nothing is created', async () => {
  assert.equal(await status(() => processTelemetry({ shipmentId: 'GHOST-1', ...SPIKE })), 404);
  assert.equal(await status(() => market.getListing('GHOST-1')), 404);
  const res = { locals: {}, json() {} };
  assert.equal(await status(() => c.getLiquidation({ params: { shipmentId: 'GHOST-1' } }, res)), 404);
  assert.equal(await status(() => c.getLiquidationHistory({ params: { shipmentId: 'GHOST-1' } }, res)), 404);
  assert.equal(await status(() => c.getMarketplaceListing({ params: { shipmentId: 'GHOST-1' } }, res)), 404);
  assert.equal(shipments.count(), 0);
  assert.equal(alerts.count(), 0);
  assert.deepEqual(market.listMarketplace(), []);
});

test('existing shipment without an active listing: 404 NO_LISTING; malformed id: 400', async () => {
  ship();
  await send('SHP-001', NORMAL);
  await assert.rejects(async () => market.getListing('SHP-001'), (e) => e.status === 404 && e.code === 'NO_LISTING');
  await assert.rejects(async () => market.getListing("x'; DROP TABLE shipments;--"), (e) => e.status === 400);
});

test('invalid stored price (0): telemetry and alert are still recorded, but no recommendation or listing is invented', async () => {
  ship();
  getDb().prepare('UPDATE shipments SET base_price_per_kg = 0 WHERE id = ?').run('SHP-001'); // API validation blocks this, so corrupt it directly
  const r = await send('SHP-001', SPIKE);
  assert.equal(r.shipment.riskLevel, 'CRITICAL');
  assert.equal(r.latestTelemetry.remainingHours, 18);
  assert.equal(r.liquidation, null);
  assert.equal(r.marketplaceListing, null);
  assert.equal(liquidations.count('SHP-001'), 0);
  assert.match(r.newAlert.message, /recommendation unavailable.*price is missing or invalid/);
  assert.equal(r.pipeline.find((s) => s.step === 'liquidation').status, 'skipped_invalid_price');
  assert.equal(r.pipeline.find((s) => s.step === 'marketplace').status, 'skipped_invalid_price');
  assert.deepEqual(market.listMarketplace(), []);
});

test('invalid shipment price is rejected at creation (zero, negative, text)', () => {
  for (const bad of [0, -10, '150', NaN]) {
    assert.throws(() => ship({ shipmentId: `BAD-${String(bad)}`, basePricePerKg: bad }), (e) => e.status === 400 && e.details.some((d) => d.field === 'basePricePerKg'));
  }
});

test('a listing created before liquidation_id existed still resolves its recommendation (legacy fallback)', async () => {
  ship();
  await send('SHP-001', SPIKE);
  getDb().prepare('UPDATE marketplace_listings SET liquidation_id = NULL').run();
  const [l] = market.listMarketplace();
  assert.equal(l.urgency, 'CRITICAL');
  assert.equal(l.band, 'STEEP');
  assert.equal(l.reason, 'Remaining shelf life is below 24 hours.');
});

test('the backend, not the client, decides: client-supplied price fields in telemetry are ignored', async () => {
  ship();
  const r = await processTelemetry({ shipmentId: 'SHP-001', ...SPIKE, discount: 99, recommendedPrice: 1, pricePerKg: 1, markdownPct: 99 });
  assert.equal(r.marketplaceListing.discount, 50);
  assert.equal(r.marketplaceListing.recommendedPrice, 75);
});
