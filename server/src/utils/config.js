// All configuration comes from environment variables. Nothing secret is hardcoded or logged.
try { process.loadEnvFile?.(); } catch { /* .env is optional */ }

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const e = process.env;

export const config = {
  env: e.NODE_ENV || 'development',
  port: int(e.PORT, 4000),
  dbPath: e.DB_PATH || './data/agrosense.db',
  corsOrigins: (e.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
  seedOnBoot: e.SEED_ON_BOOT !== 'false',
  logLevel: e.LOG_LEVEL || 'info',
  defaultBasePricePerKg: int(e.DEFAULT_BASE_PRICE_PER_KG, 150),
  ai: {
    // AI_API_KEY is the documented name; ANTHROPIC_API_KEY is accepted as an alias. Server-side only, never sent to the browser.
    apiKey: e.AI_API_KEY || e.ANTHROPIC_API_KEY || '',
    model: e.AI_MODEL || 'claude-sonnet-5-5',
    timeoutMs: int(e.AI_TIMEOUT_MS, 8000),   // per attempt
    maxRetries: Math.min(Math.max(int(e.AI_MAX_RETRIES, 1), 0), 1), // spec: retry ONCE at most
    apiUrl: e.AI_API_URL || 'https://api.anthropic.com/v1/messages',
  },
};
