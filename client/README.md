# AgroSense client

    npm install && cp .env.example .env && npm run dev   # http://localhost:5173, proxies /api -> :4000

No secrets live here. The browser only calls `/api/*`. All shelf-life, risk, liquidation, alert, marketplace and AI values come from the backend.

## Response shapes the UI reads (snake_case or camelCase both accepted, see src/utils/normalize.js)
- GET /api/shipments -> array of shipment rows (id, produce_type, origin, destination, quantity, risk_level, remaining_hours, status)
- GET /api/telemetry/:id -> array, oldest first (temperature, humidity, transit_minutes, spoilage_rate, remaining_hours, risk_level, recorded_at)
- POST /api/simulate/temperature-spike/:id -> any 2xx JSON (UI re-fetches everything afterwards)
- GET /api/alerts -> array (id, shipment_id, severity, message, is_read, created_at)
- PATCH /api/alerts/:id/read
- GET /api/liquidation/:id -> latest plan object ({required, markdownPct, originalPricePerKg, markdownPricePerKg, estimatedRecovery, estimatedLossAvoided, sellWithinHours, action, reason?}); 404 = none yet
- GET /api/ai-insights/:id -> latest {source, insight}. insight is either text or JSON {why, riskExplanation, recommendedAction, urgency}; 404 = none yet
- GET /api/marketplace -> array of listings (id, shipment_id, produce_type, quantity, price_per_kg, markdown_pct, remaining_hours, status)
