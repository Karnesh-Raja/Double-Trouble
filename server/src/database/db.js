// SQLite via Node's built-in node:sqlite (no native build step). All state is persisted here.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../utils/config.js';

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY, produce_type TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
  baseline_shelf_life_hours REAL NOT NULL, quantity REAL NOT NULL, base_price_per_kg REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT', risk_level TEXT NOT NULL DEFAULT 'LOW',
  remaining_hours REAL, last_telemetry_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id TEXT NOT NULL REFERENCES shipments(id),
  temperature REAL NOT NULL, humidity REAL NOT NULL, transit_minutes REAL NOT NULL,
  spoilage_rate REAL NOT NULL, remaining_hours REAL NOT NULL, risk_level TEXT NOT NULL,
  source TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_telemetry_shipment ON telemetry(shipment_id, id);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id TEXT NOT NULL REFERENCES shipments(id), telemetry_id INTEGER,
  severity TEXT NOT NULL, message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS liquidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id TEXT NOT NULL REFERENCES shipments(id), telemetry_id INTEGER,
  risk_level TEXT NOT NULL, plan_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id TEXT NOT NULL REFERENCES shipments(id), produce_type TEXT NOT NULL,
  quantity REAL NOT NULL, original_price_per_kg REAL NOT NULL, price_per_kg REAL NOT NULL, markdown_pct REAL NOT NULL,
  remaining_hours REAL NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', retailer_notified INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
-- At most one OPEN listing per shipment, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_listing ON marketplace_listings(shipment_id) WHERE status = 'OPEN';
CREATE TABLE IF NOT EXISTS ai_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id TEXT NOT NULL REFERENCES shipments(id), telemetry_id INTEGER,
  risk_level TEXT NOT NULL, source TEXT NOT NULL, model TEXT, insight_json TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
-- AI observability: one row per AI request (including skipped and failed ones). Never stores prompts, responses or secrets.
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, shipment_id TEXT, telemetry_id INTEGER,
  model TEXT, prompt_version TEXT NOT NULL, status TEXT NOT NULL, failure_type TEXT, success INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE INDEX IF NOT EXISTS idx_ai_calls_created ON ai_calls(id);
`;

// Additive migrations for databases created before prompt versioning existed.
const MIGRATIONS = [
  ['ai_insights', 'prompt_version', 'TEXT'],
  ['ai_insights', 'latency_ms', 'INTEGER'],
  ['ai_insights', 'attempts', 'INTEGER'],
  ['ai_insights', 'failure_type', 'TEXT'],
  ['marketplace_listings', 'liquidation_id', 'INTEGER'], // the recommendation (liquidations.id) that priced this listing
];
function migrate(d) {
  for (const [table, column, type] of MIGRATIONS) {
    const has = d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function initDb(file = config.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const getDb = () => db || initDb();
export const closeDb = () => { if (db) { db.close(); db = undefined; } };
export const ping = () => getDb().prepare('SELECT 1 AS ok').get().ok === 1;

// Atomic multi-table write. Any error rolls everything back, so state never half-updates.
export function transaction(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try { const result = fn(); d.exec('COMMIT'); return result; }
  catch (err) { try { d.exec('ROLLBACK'); } catch { /* already rolled back */ } throw err; }
}
