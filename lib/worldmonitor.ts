/**
 * World Monitor — Country Instability Index (CII)
 * API spec: https://worldmonitor.app/docs/api/IntelligenceService.openapi.yaml
 *
 * The API returns a current snapshot (no history endpoint).
 * Sparkline is built from stored kriMeasurement records in the local DB,
 * growing naturally with each daily scan.
 *
 * Env: WORLDMONITOR_API_KEY
 */

import { prisma } from "./prisma";
import type { KriResult } from "./gdelt";

const API_BASE = "https://worldmonitor.app";

// European countries by ISO 3166-1 alpha-2 that World Monitor tracks
// Focus on those most relevant to EU risk picture (conflict zones + neighbours)
const EU_COUNTRIES = [
  "UA", // Ukraine
  "RU", // Russia
  "BY", // Belarus
  "TR", // Turkey
  "RS", // Serbia
  "BA", // Bosnia & Herzegovina
  "GE", // Georgia
  "MD", // Moldova
  "AZ", // Azerbaijan
  "AM", // Armenia
  "XK", // Kosovo
  "MK", // North Macedonia
  "AL", // Albania
  "ME", // Montenegro
  "HU", // Hungary
  "PL", // Poland
  "RO", // Romania
  "BG", // Bulgaria
  "SK", // Slovakia
  "DE", // Germany
  "FR", // France
  "GB", // United Kingdom
];

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface CiiScore {
  region:          string;
  staticBaseline:  number;
  dynamicScore:    number;
  combinedScore:   number;
  trend:           "RISING" | "STABLE" | "FALLING";
  computedAt:      number; // Unix epoch ms
}

interface GetRiskScoresResponse {
  ciiScores:      CiiScore[];
  strategicRisks: unknown[];
}

interface GetCountryRiskResponse {
  countryCode:         string;
  countryName:         string;
  cii:                 CiiScore;
  advisoryLevel:       string;
  sanctionsActive:     boolean;
  sanctionsCount:      number;
  upstreamUnavailable: boolean;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function authHeader(): Record<string, string> {
  const key = process.env.WORLDMONITOR_API_KEY;
  if (!key) throw new Error("WORLDMONITOR_API_KEY must be set in environment variables");
  return { Authorization: `Bearer ${key}` };
}

async function fetchRiskScores(): Promise<CiiScore[]> {
  const res = await fetch(
    `${API_BASE}/api/intelligence/v1/get-risk-scores`,
    { headers: authHeader() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`World Monitor get-risk-scores error (${res.status}): ${text}`);
  }

  const json: GetRiskScoresResponse = await res.json();
  return json.ciiScores ?? [];
}

async function fetchCountryRisk(countryCode: string): Promise<GetCountryRiskResponse | null> {
  const res = await fetch(
    `${API_BASE}/api/intelligence/v1/get-country-risk?country_code=${countryCode}`,
    { headers: authHeader() }
  );

  if (!res.ok) return null;

  const json: GetCountryRiskResponse = await res.json();
  if (json.upstreamUnavailable) return null;
  return json;
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/**
 * Fetches CII for EU_COUNTRIES and returns the average combinedScore.
 * Falls back to bulk get-risk-scores and filters by region prefix.
 */
async function getCurrentEuCiiScore(): Promise<{ score: number; trend: KriResult["trend"] }> {
  // Try bulk endpoint first (one call for all regions)
  const allScores = await fetchRiskScores();

  // Filter to our EU country list by region identifier
  const euScores = allScores.filter((s) =>
    EU_COUNTRIES.some((code) =>
      s.region.toUpperCase() === code ||
      s.region.toUpperCase().startsWith(code + "-") ||
      s.region.toUpperCase().startsWith(code + "_")
    )
  );

  if (euScores.length >= 3) {
    // Enough EU countries in the bulk response — use them
    const avg = euScores.reduce((sum, s) => sum + s.combinedScore, 0) / euScores.length;

    const rising  = euScores.filter((s) => s.trend === "RISING").length;
    const falling = euScores.filter((s) => s.trend === "FALLING").length;
    const trend: KriResult["trend"] =
      rising > falling + 2 ? "rising" : falling > rising + 2 ? "falling" : "stable";

    return { score: Math.round(avg), trend };
  }

  // Bulk result didn't have enough EU countries — query individually (parallel)
  const results = await Promise.allSettled(
    EU_COUNTRIES.map((code) => fetchCountryRisk(code))
  );

  const valid = results
    .filter((r): r is PromiseFulfilledResult<GetCountryRiskResponse> =>
      r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);

  if (valid.length === 0) {
    throw new Error("World Monitor: no EU country scores available");
  }

  const avg = valid.reduce((sum, c) => sum + c.cii.combinedScore, 0) / valid.length;

  const rising  = valid.filter((c) => c.cii.trend === "RISING").length;
  const falling = valid.filter((c) => c.cii.trend === "FALLING").length;
  const trend: KriResult["trend"] =
    rising > falling + 2 ? "rising" : falling > rising + 2 ? "falling" : "stable";

  return { score: Math.round(avg), trend };
}

// ---------------------------------------------------------------------------
// Sparkline from DB history
// ---------------------------------------------------------------------------

async function buildSparklineFromDb(): Promise<{
  sparkline:    number[];
  volume7dPrev: number;
  avgDaily:     number;
}> {
  // Read last 30 stored CII measurements (oldest → newest)
  const past = await prisma.kriMeasurement.findMany({
    where: { key: "worldmonitor_cii" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { score: true },
  });

  if (past.length === 0) {
    return { sparkline: [], volume7dPrev: 0, avgDaily: 0 };
  }

  // Reverse so sparkline is oldest → newest
  const sparkline = past.map((m) => Math.round(m.score)).reverse();
  const avgDaily  = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;

  // "prev" score = oldest stored value (as a proxy for previous period)
  const volume7dPrev = sparkline[0] ?? 0;

  return { sparkline, volume7dPrev, avgDaily: Math.round(avgDaily * 10) / 10 };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function measureWorldMonitorKri(): Promise<KriResult> {
  const [current, history] = await Promise.all([
    getCurrentEuCiiScore(),
    buildSparklineFromDb(),
  ]);

  const trendPct =
    history.volume7dPrev > 0
      ? Math.round(((current.score - history.volume7dPrev) / history.volume7dPrev) * 100)
      : 0;

  return {
    key:          "worldmonitor_cii",
    name:         "Country Instability Index · Europe (WM)",
    category:     "Geopolitical",
    volume7d:     current.score,   // current CII score (0–100)
    volume7dPrev: history.volume7dPrev,
    avgDaily:     history.avgDaily,
    score:        current.score,   // already 0–100, no normalization needed
    trend:        current.trend,
    trendPct,
    sparkline:    history.sparkline,
  };
}
