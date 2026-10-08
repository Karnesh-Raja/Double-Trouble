# AgroSense backend

    npm install && cp .env.example .env && npm start      # needs Node >= 22.13, listens on :4000
    npm run verify    # in-process pipeline test (no network, no Express)
    npm run smoke     # HTTP test against the running server

SHP-001 is seeded on first boot (SEED_ON_BOOT=true). Data lives in ./data/agrosense.db (delete it to reset, or call POST /api/simulate/normal/SHP-001).

## Architecture
    routes -> controllers -> services -> engines (pure) + database/repositories (SQLite)
    middleware: requestLogger, errorHandler, asyncHandler     utils: config, logger, validators, errors

    processTelemetry(): validate -> [ONE DB TRANSACTION: shelf life -> risk -> persist telemetry -> liquidation -> alert -> marketplace] -> AI (after commit) -> read back full state

## Engines (explainable)
- Shelf life = baseline / (1 + temperatureStress + humidityStress + transitStress). Normal 120h; the 12C/85%/240min spike gives 18h. Full write-up: SHELF_LIFE_MODEL.md. All numbers in src/engines/modelConfig.js.
- Risk (calculateRisk): > 72h LOW, 48-72 MEDIUM, 24-48 HIGH, < 24 CRITICAL. Configurable.
- `npm test` runs 81 tests (20 shelf-life/risk + 24 AI + 23 liquidation engine + 14 pipeline/marketplace); `npm run verify` runs the pipeline test, including the AI success, retry and failure paths.
- Liquidation: discount bands by remaining shelf life (> 72h 0%, 48-72 10%, 24-48 25%, 12-24 50%, < 12 70%), set in `src/engines/liquidationConfig.js` and calculated only by the backend; sell within 50% of remaining life. Full write-up: **LIQUIDATION_LOGIC.md**.
- AI explains; it never sets numbers. Full design: **AI_ARCHITECTURE.md** (prompt, schemas, validation, fallback, security, logging).
  - Output: `summary, riskExplanation, recommendedAction, retailerMessage, urgency` (urgency must equal the deterministic risk).
  - Key: `AI_API_KEY` in `.env` (server-side only; see `.env.example`). `PROMPT_VERSION = "v1.0"` is stored with every insight.
  - Output is validated (JSON, fields, urgency, no invented numbers); one retry; else deterministic fallback (`source: fallback-template`).
  - Observability: every AI request is logged to `ai_calls` (timestamp, shipment, model, prompt version, status, latency, success). No prompts or secrets.

## API (shared contract preserved; one additive route)
GET /api/health | GET,POST /api/shipments | GET /api/shipments/:id | GET /api/telemetry/:shipmentId | POST /api/telemetry
POST /api/simulate/temperature-spike/:shipmentId | GET /api/alerts | PATCH /api/alerts/:id/read
GET /api/liquidation/:shipmentId | GET /api/ai-insights/:shipmentId | GET /api/marketplace
ADDITIVE: POST /api/simulate/normal/:shipmentId (reset demo to NORMAL) | GET /api/ai-telemetry (AI status, latency, prompt version)
ADDITIVE (liquidation): GET /api/marketplace/summary (estimated loss avoided) | GET /api/marketplace/:shipmentId | GET /api/liquidation/:shipmentId/history
`GET /api/marketplace` returns active lots, least shelf life first, with backend-calculated `discount`, `recommendedPrice`, `urgency` and a `display` block; the first contract's field names are still included.
Errors: { error, code, details? } with 400 / 404 / 409 / 413 / 500 / 503. Never a stack trace.
