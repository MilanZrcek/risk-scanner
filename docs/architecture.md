# EU Financial Risk Scanner — Architecture & Technical Description

---

## Overview

The EU Financial Risk Scanner is a daily-automated risk intelligence platform built for monitoring external risk signals relevant to European financial institutions. It combines AI-driven news analysis with structured quantitative data sources to produce a unified risk dashboard updated twice per day.

The system produces two layers of output:

1. **AI-identified Risk Topics** — news articles grouped into thematic risks, each with an impact score, narrative summary, and source attribution. Updated once daily (06:00 UTC).
2. **Key Risk Indicators (KRIs)** — quantitative 0–100 scores with 30-point sparklines, trend direction, and drill-down detail modals. Updated twice daily (06:00 and 12:00 UTC).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| ORM | Prisma 6 |
| Database | Neon PostgreSQL (serverless, connection pooling) |
| Hosting | Vercel (serverless functions, cron) |
| AI model | Anthropic Claude Sonnet 4.6 |
| Styling | Tailwind CSS |
| Schema management | `prisma db push` (no migration files) |

---

## Scan Triggers

Two Vercel crons run daily (Hobby plan: maximum 2 crons, once-daily each):

| Cron | Time | Endpoint | What runs |
|---|---|---|---|
| Full scan | 06:00 UTC | `GET /api/cron/scan` | KRIs + NewsAPI fetch + Claude analysis |
| KRI scan | 12:00 UTC | `GET /api/cron/kri` | KRIs only (no Claude API cost) |

Both endpoints require `Authorization: Bearer CRON_SECRET`. `maxDuration` is 300 seconds.

Manual triggers are available via `POST /api/scan` (full) and `POST /api/scan/kri` (KRI-only) with the same secret.

---

## Scan Pipeline (`lib/scanner.ts`)

The scanner exposes three functions:

- **`runKriScan()`** — fetches all KRI sources in parallel, writes `KriMeasurement[]` + its own `ScanRun` record. No Claude API call.
- **`runNewsScan()`** — fetches news + runs Claude analysis, writes `RiskTopic[]` + `Article[]` + its own `ScanRun` record.
- **`runScan()`** — calls both via `Promise.allSettled` (used by the 06:00 full scan).

Each scan type creates **its own** `ScanRun` record. The dashboard page reads them independently: KRI measurements from the latest completed scan (any type), topics from the latest scan with `topicsFound > 0`.

### Phase 1 — Fetch News (`lib/newsapi.ts`)

Queries NewsAPI.org with 5 EU-financial-focused search terms in parallel, deduplicates by URL, caps at 40 articles. Window: last 7 days.

### Phase 2 — Analyze with Claude (`lib/analyzer.ts`)

All articles are sent in a single prompt to **claude-sonnet-4-6** (no extended thinking, `max_tokens: 4096`, simple `messages.create()`).

Claude groups articles into risk topics and for each produces: title, 2–3 sentence summary, category, impact score (1–10), and impact reasoning as structured JSON.

**Categories:** Regulatory · Cybersecurity · Market · Geopolitical · Technology · Operational

### Phase 3 — Measure KRIs (`Promise.allSettled`)

All KRI sources run in parallel. A failed source logs a warning but does not abort — other sources still persist.

#### 3a. Internal DB KRI (`lib/gdelt.ts`)

Derives 5 category-level KRIs from the application's own scan history. For each of the 5 categories:

- Fetches the last 30 completed `ScanRun` records from the database
- Computes average `impactScore` of topics in that category per scan
- **Score** = `avgImpactScore × 10`
- **Trend** = comparison of latest vs previous scan (±10% threshold)

#### 3b. NOTAM Airspace Restrictions (`lib/notam.ts`)

Monitors 25 globally significant FIRs via SkyLink (RapidAPI).

**Tier classification** (derived from NOTAM text, not hardcoded by country):
- **Tier 3** → FIR CLOSED, FLT SUSPENDED, MILITARY INVASION, ARMED CONFLICT, HOSTILITIES, WAR ZONE
- **Tier 1** → all other matched geopolitical restrictions

**Score:** `min(100, Σ(min(count_per_FIR, 20) × tier × 5) / 4)`

Expired NOTAMs are filtered. `isNew` flag compares against previous scan's detail list.

**Details** stored as JSON array: powers the click-through NOTAM modal.

#### 3c. ACLED Violence Events (`lib/acled.ts`)

Downloads the ACLED weekly Excel file via Drupal session login (no paid API):

1. GET login page → extract CSRF `form_build_id`
2. POST credentials → capture `SESS*` session cookie
3. Probe last 8 Saturdays for the current Excel file URL (month-based directory)
4. Parse with SheetJS (`xlsx`), filter to `EU_COUNTRIES` set (EU-27), current week only

**Score:** `min(100, events_week / 6000 × 100)` (reference: ~3,040 events/week baseline)

**Details** stored as JSON: `byCountry`, `byEventType`, `weekDate`, totals. Powers the ACLED modal.

#### 3d. ReliefWeb Humanitarian Crises (`lib/reliefweb.ts`) — *pending appname approval*

Two KRIs: new crisis count (last 7 days) and type-weighted severity index.

#### 3e. SkyLink / NOTAM — see 3b above.

#### 3f. MeteoAlarm Weather Warnings (`lib/meteoalarm.ts`)

Fetches all 27 EU member state CAP Atom feeds from MeteoAlarm (EUMETNET) in parallel, with 8-second timeout per feed.

- Parses `<cap:severity>`, `<cap:event>`, `<cap:areaDesc>`, `<cap:sent>` via regex
- **Only red (Extreme) and orange (Severe)** warnings are stored — moderate/yellow excluded
- **Score:** `min(100, (red×4 + orange×2) / 20 × 100)`
- **Details:** full warning list with country, area, event type, severity, date — powers MeteoAlarm modal

#### 3g. EFI Extreme Weather (`lib/efi.ts`)

Approximates ECMWF Extreme Forecast Index via Open-Meteo (free, no API key). Cities: Brussels, Prague, Bratislava, Budapest, Bucharest.

- Fetches `past_days=30&forecast_days=7` for temperature max, precipitation sum, wind speed max
- **EFI formula:** `z = (peak_7d_forecast − 30d_baseline_mean) / max(actual_std, min_std)`
  - `min_std`: temperature 4°C · precipitation 5mm · wind 10 km/h (prevents dry/calm periods from inflating z-scores when baseline variance is near zero)
  - `EFI = min(1, |z| / 3)` · capped at 3σ = score 100
- **Score:** `max EFI across 5 cities × 100`
- **Details:** per-city breakdown with peak forecast value, 30-day baseline mean, σ deviation, and 7-day sparkline — powers EFI modal with interpretable labels (e.g. "32°C avg 24°C +3.1σ")

#### 3h. WorldMonitor CII (`lib/worldmonitor.ts`) — *placeholder, no public API*

#### Phase 4 — Persist (`prisma.$transaction`)

One database transaction writes:
- `ScanRun` record (status: completed, topicsFound, articlesRead)
- `KriMeasurement[]` including serialized `sparkline` (30-element JSON array) and `details` (JSON blob)
- `RiskTopic[]` with nested `Article[]` children (news scan only)

---

## Database Schema

```
ScanRun
  id · startedAt · completedAt · status · topicsFound · articlesRead · error

RiskTopic  (→ ScanRun)
  id · title · summary · category · impactScore · impactReason

Article  (→ RiskTopic)
  id · title · source · url · publishedAt · summary

KriMeasurement  (→ ScanRun)
  id · key · name · category
  volume7d · volume7dPrev · avgDaily
  score · trend · trendPct
  sparkline  (TEXT, JSON array — 30 points)
  details    (TEXT, JSON blob — nullable, powers drill-down modals)
```

Indexes: `ScanRun.startedAt`, `KriMeasurement(key, createdAt)`, `RiskTopic(impactScore)`, `RiskTopic(category)`.

Schema managed with `prisma db push` (no migration files) to avoid data resets on a live production database.

---

## Frontend (`app/page.tsx` + components)

Server-rendered Next.js page (`force-dynamic`, `revalidate: 0`) that queries the database directly via Prisma on each request.

**Dual scan lookup:** KRI measurements are fetched from the latest completed `ScanRun` (any type, including KRI-only crons). Risk topics are fetched from the latest `ScanRun` where `topicsFound > 0` (news+AI scan). This prevents the 12:00 KRI cron from hiding the 06:00 news topics.

### Components

| Component | Type | Role |
|---|---|---|
| `KriPanel` | Client (`"use client"`) | KRI card grid + 4 detail modals |
| `KriCard` | Client (child) | Score gauge, sparkline SVG, trend arrow |
| `NotamModal` | Client (child) | NOTAM list: tier badges, NEW flags, date ranges |
| `AcledModal` | Client (child) | Violence events by country and event type |
| `MeteoAlarmModal` | Client (child) | Weather warnings: red+orange only, filtered at display time |
| `EfiModal` | Client (child) | Per-city: peak forecast vs baseline, σ deviation labels, 7-day sparkline |
| `RiskCard` | Server | Topic card with category badge, score, article count |
| `CategoryFilter` | Server | URL-param category filter (`?category=`) |

Modal type is detected from the shape of the parsed `details` JSON blob (array → NOTAM, `byCountry` → ACLED, `warnings` → MeteoAlarm, `cities` → EFI).

### KRI Card display

Each KRI card shows:
- **Score gauge** — 0–100 with colored bar (green < 45, yellow 45–70, red ≥ 70)
- **Sparkline** — SVG polyline of last 30 data points with gradient fill
- **Trend arrow** — red up (+%), green down (−%), gray stable
- **Volume** — raw count with KRI-specific unit label
- **Info icon** — if `details` is present, clicking opens the drill-down modal

---

## REST API

### `GET /api/risks?category=&scanRunId=`

```json
{
  "topics": [...],
  "scanRun": { "id": "...", "startedAt": "...", "topicsFound": 8 },
  "scanRuns": [...],
  "kriMeasurements": [
    {
      "key": "weather_efi", "score": 45, "trend": "stable",
      "sparkline": "[12,18,45]",
      "details": "{\"cities\":[{\"name\":\"Prague\",\"tempMax\":22,\"tempMean\":14,\"tempZ\":2.1,...}]}"
    }
  ]
}
```

---

## Data Flow Summary

```
06:00 UTC — Vercel Cron (full scan)
        │
        ▼
   /api/cron/scan → lib/scanner.ts:runScan()
   ┌──────────────────────────────────────────────────┐
   │  runNewsScan()                                    │
   │    fetchEUFinancialNews()  → NewsAPI.org          │
   │    analyzeArticles()       → Claude Sonnet 4.6    │
   │    → ScanRun #A + RiskTopic[] + Article[]         │
   │                                                   │
   │  runKriScan()                                     │
   │    measureKRIs()           → internal DB          │
   │    measureNotamKri()       → SkyLink / RapidAPI   │
   │    measureAcledKri()       → ACLED Excel download │
   │    measureReliefWebKris()  → ReliefWeb (pending)  │
   │    measureMeteoAlarmKri()  → MeteoAlarm CAP feeds │
   │    measureEfiKri()         → Open-Meteo (free)    │
   │    → ScanRun #B + KriMeasurement[]                │
   └──────────────────────────────────────────────────┘

12:00 UTC — Vercel Cron (KRI-only)
        │
        ▼
   /api/cron/kri → lib/scanner.ts:runKriScan()
   → ScanRun #C + KriMeasurement[] (no topics, no Claude)

app/page.tsx — on browser request
   KRI:    ScanRun.findFirst (latest any)     → KriMeasurement[]
   Topics: ScanRun.findFirst (topicsFound>0)  → RiskTopic[]
        │
        ▼
   KriPanel + RiskCard grid → Browser
```

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | Prisma | Neon PostgreSQL connection string |
| `NEWS_API_KEY` | newsapi.ts | NewsAPI.org key |
| `ANTHROPIC_API_KEY` | analyzer.ts | Claude API key |
| `CRON_SECRET` | cron routes | Authenticates scheduled and manual triggers |
| `RAPIDAPI_KEY` | notam.ts | SkyLink NOTAM API via RapidAPI |
| `ACLED_EMAIL` | acled.ts | Drupal login email for ACLED Excel download |
| `ACLED_PASSWORD` | acled.ts | Drupal login password |
| `RELIEFWEB_APPNAME` | reliefweb.ts | App identifier for ReliefWeb API (pending) |
| `WORLDMONITOR_API_KEY` | worldmonitor.ts | Placeholder, not active |
| `SKIP_GDELT` | scanner.ts | Set to `"true"` to skip internal DB KRI |
