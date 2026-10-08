# AgroSense

**Cold-chain shelf-life monitoring and retailer liquidation for perishable produce.**

AgroSense tracks produce shipments in transit, estimates how much shelf life is left from temperature, humidity and transit time, rates the spoilage risk, and recommends a markdown price when a lot is losing shelf life. Retailers see the discounted lot in a marketplace, and an AI assistant explains the situation in plain language.

---

## Team

- **Diwagar S**
- **C Karnesh Raja**

**Institution:** SRM Valliammai Engineering College
**Department:** Artificial Intelligence and Data Science (AI & DS)
**Year:** First Year

---

## The problem

A large share of fresh produce is lost during transport because temperature excursions go unnoticed until the produce has already spoiled. When a lot is close to spoiling, the choice is either a deep, late discount or total write-off. AgroSense aims to make that decision earlier and clearer.

## What it does

- **Live dashboard** for each shipment: current temperature, humidity, transit time, remaining shelf life and risk level.
- **Shelf-life engine** (deterministic, explainable): shelf life is the baseline divided by a degradation multiplier built from temperature, humidity and transit stress.
- **Risk engine:** LOW, MEDIUM, HIGH or CRITICAL based on remaining hours.
- **Liquidation engine:** chooses a discount band (0%, 10%, 25%, 50% or 70%) from remaining shelf life, and calculates the recommended price per kg.
- **Marketplace:** one open listing per shipment, re-priced automatically as conditions change, with an estimate of loss avoided.
- **Alerts** when risk escalates or a discount deepens.
- **AI explanation** of each high-risk situation, with a deterministic fallback when the AI service is unavailable.
- **Persistent state** stored in MySQL, so the dashboard shows the same data after a refresh or restart.
- **Temperature-spike simulation** for demonstration, since the project has no physical sensors.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, Recharts, React Router |
| Backend | Node.js 22, Express 4 |
| Database | MySQL 8.0.16 or newer (`mysql2` driver) |
| AI | Anthropic Claude API, called only from the server, with a rule-based fallback |

## Repository layout

```
double-trouble/
├── client/                  React dashboard (Vite)
│   └── src/
│       ├── components/      Dashboard panels, charts, alerts, marketplace cards
│       ├── pages/           Dashboard and Marketplace pages
│       ├── hooks/           Shared data loading and state
│       └── services/        Thin API client (no business logic)
└── server/                  Express API and business logic
    ├── src/
    │   ├── engines/         Shelf-life, risk and liquidation engines (pure functions)
    │   ├── services/        Telemetry pipeline, AI, marketplace, seeding
    │   ├── ai/              Prompt, output validation and fallback
    │   ├── database/        MySQL access layer, schema.sql, repositories
    │   ├── controllers/     Request handlers
    │   └── middleware/      Error handling and request logging
    ├── test/                Unit and integration tests
    └── scripts/             Seed, end-to-end verify and HTTP smoke test
```

## Getting started

### Requirements
- Node.js 22.13 or newer
- MySQL 8.0.16 or newer

### 1. Create the database

```sql
CREATE DATABASE agrosense CHARACTER SET utf8mb4;
CREATE USER 'agro_app'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON agrosense.* TO 'agro_app'@'localhost';
```

### 2. Start the backend

```bash
cd server
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env` and set `DATABASE_URL`:

```
DATABASE_URL=mysql://agro_app:choose-a-strong-password@localhost:3306/agrosense
```

Then start the server:

```bash
npm start
```

The server creates the tables and seeds three demo shipments on first run. Check it at http://localhost:4000/api/health.

### 3. Start the frontend

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173.

### 4. Run the demo

1. Open the dashboard and select **SHP-001** (Tomatoes, Chennai to Bengaluru, 1000 kg, 120-hour baseline). It starts at about 5 days of shelf life with LOW risk.
2. Click **temperature spike**. Shelf life falls to about 18 hours, risk becomes CRITICAL, and the AI explanation, liquidation recommendation, alert and marketplace listing appear.
3. Refresh the page. The changes remain, because they are stored in the database.

### Tests

```bash
cd server
npm test                    # unit tests; database tests run only when TEST_DATABASE_URL is set
npm run verify              # full pipeline check; needs TEST_DATABASE_URL
npm run smoke               # HTTP check against the running server
```

`TEST_DATABASE_URL` must point to a separate, disposable database. `npm run verify` drops and recreates its tables.

## API overview

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Server and database status |
| GET | `/api/shipments` | List shipments |
| GET | `/api/shipments/:id` | Full state of one shipment |
| POST | `/api/shipments` | Create a shipment |
| GET | `/api/telemetry/:shipmentId` | Recent readings, oldest first |
| POST | `/api/telemetry` | Submit a reading (runs the full pipeline) |
| POST | `/api/simulate/temperature-spike/:shipmentId` | Demo: inject a spike |
| POST | `/api/simulate/normal/:shipmentId` | Demo: reset to normal conditions |
| GET | `/api/alerts` | Alerts (`?unread=true` for unread only) |
| PATCH | `/api/alerts/:id/read` | Mark an alert as read |
| GET | `/api/liquidation/:shipmentId` | Latest liquidation recommendation |
| GET | `/api/ai-insights/:shipmentId` | Latest AI explanation |
| GET | `/api/marketplace` | Open listings, most urgent first |
| GET | `/api/marketplace/summary` | Totals and estimated loss avoided |

Errors return `{ "error": "...", "code": "..." }` with a standard HTTP status. Stack traces and database details are never sent to the client.

## Documentation

| File | Contents |
|---|---|
| `server/README.md` | Backend setup and architecture |
| `server/SHELF_LIFE_MODEL.md` | How remaining shelf life is calculated |
| `server/LIQUIDATION_LOGIC.md` | Discount bands, pricing and loss-avoided estimates |
| `server/AI_ARCHITECTURE.md` | Prompt, output validation, fallback and logging |
| `server/DATABASE.md` | Schema, relationships, validation and failure handling |
| `server/SECURITY.md` | Secret handling, audit results and open risks |

## Security

- The AI key and database password live only in the server's `.env` file, which is never committed.
- The browser never talks to the database or the AI provider. It only calls `/api`.
- Every database query uses parameter placeholders.
- CORS allows only explicitly listed origins.
- Input is validated at the API, in the engines, and by database constraints.

See `server/SECURITY.md` for the full list and the open risks. In particular, the API currently has no authentication, so it should only run on a private network.

## Limitations

- Temperature readings are simulated; there are no physical sensors.
- Discount bands and the sell-through rate are assumptions set in the configuration, not values measured from market data.
- Retailer notification is a dashboard flag only; no email or SMS is sent.
- There is no authentication or rate limiting yet.

## Acknowledgements

Built as a first-year project in the Department of Artificial Intelligence and Data Science, SRM Valliammai Engineering College.
