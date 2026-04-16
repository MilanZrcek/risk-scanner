/**
 * FRED (Federal Reserve Economic Data) – VIX integration
 * API docs: https://fred.stlouisfed.org/docs/api/fred/
 *
 * Series: VIXCLS – CBOE Volatility Index (daily close)
 * Free API key required: https://fred.stlouisfed.org/docs/api/api_key.html
 * Env: FRED_API_KEY
 *
 * VIX interpretation:
 *   < 15   Low volatility / calm markets
 *   15–20  Normal range
 *   20–30  Elevated uncertainty
 *   30–40  High fear
 *   > 40   Extreme fear / crisis
 */

import type { KriResult } from "./gdelt";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FredObservation {
  date:  string;   // "YYYY-MM-DD"
  value: string;   // numeric string or "." for missing
}

interface FredResponse {
  observations: FredObservation[];
}

export interface VixDataPoint {
  date:  string;
  value: number;
}

export interface FredVixDetails {
  current:     number;     // latest VIX close
  avg7d:       number;     // 7-day average
  avg7dPrev:   number;     // prior 7-day average
  min30d:      number;
  max30d:      number;
  dataPoints:  VixDataPoint[];  // last 30 trading days
  fetchedAt:   string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vixLevel(vix: number): string {
  if (vix < 15)  return "Low";
  if (vix < 20)  return "Normal";
  if (vix < 30)  return "Elevated";
  if (vix < 40)  return "High";
  return "Extreme";
}

// Score: VIX 10 → 0, VIX 40 → 100 (linear, clamped)
function vixScore(vix: number): number {
  return Math.min(100, Math.max(0, Math.round(((vix - 10) / 30) * 100)));
}

// ---------------------------------------------------------------------------
// FRED fetch
// ---------------------------------------------------------------------------

async function fetchVix(apiKey: string, days: number): Promise<VixDataPoint[]> {
  const observationEnd   = new Date();
  const observationStart = new Date();
  observationStart.setDate(observationStart.getDate() - days);

  const params = new URLSearchParams({
    series_id:          "VIXCLS",
    api_key:            apiKey,
    file_type:          "json",
    observation_start:  observationStart.toISOString().split("T")[0],
    observation_end:    observationEnd.toISOString().split("T")[0],
    sort_order:         "asc",
  });

  const url = `${FRED_BASE}?${params}`;
  const res  = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FRED API error (${res.status}): ${text}`);
  }

  const json: FredResponse = await res.json();

  // Filter out missing values ("." placeholder used by FRED on weekends/holidays)
  return json.observations
    .filter((o) => o.value !== "." && o.value !== "")
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function measureFredVixKri(): Promise<KriResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY must be set");

  // Fetch ~60 calendar days to get at least 30 trading days
  const allPoints = await fetchVix(apiKey, 60);

  if (allPoints.length < 2) {
    throw new Error("FRED VIX: insufficient data points returned");
  }

  // Use last 30 trading-day data points
  const points30 = allPoints.slice(-30);

  // Current and averages
  const current   = points30[points30.length - 1].value;
  const last7     = points30.slice(-7).map((p) => p.value);
  const prev7     = points30.slice(-14, -7).map((p) => p.value);
  const avg7d     = last7.reduce((s, v) => s + v, 0) / last7.length;
  const avg7dPrev = prev7.length > 0 ? prev7.reduce((s, v) => s + v, 0) / prev7.length : avg7d;

  const min30d = Math.min(...points30.map((p) => p.value));
  const max30d = Math.max(...points30.map((p) => p.value));

  // Sparkline: 30 daily VIX values
  const sparkline = points30.map((p) => Math.round(p.value * 10) / 10);

  // Trend based on 7d average vs prior 7d
  const trendPct =
    avg7dPrev > 0
      ? Math.round(((avg7d - avg7dPrev) / avg7dPrev) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  // Score uses current VIX value
  const score = vixScore(current);

  const avgDaily = Math.round(avg7d * 10) / 10;

  const details: FredVixDetails = {
    current:    Math.round(current * 10) / 10,
    avg7d:      Math.round(avg7d * 10) / 10,
    avg7dPrev:  Math.round(avg7dPrev * 10) / 10,
    min30d:     Math.round(min30d * 10) / 10,
    max30d:     Math.round(max30d * 10) / 10,
    dataPoints: points30,
    fetchedAt:  new Date().toISOString(),
  };

  console.info(
    `[FRED VIX] current=${current} (${vixLevel(current)}), ` +
    `avg7d=${avg7d.toFixed(1)}, trendPct=${trendPct}%, score=${score}`
  );

  return {
    key:          "fred_vix",
    name:         "Market Volatility · VIX (FRED)",
    category:     "Market",
    volume7d:     Math.round(avg7d * 10) / 10,
    volume7dPrev: Math.round(avg7dPrev * 10) / 10,
    avgDaily,
    score,
    trend,
    trendPct,
    sparkline,
    details,
  };
}
