/**
 * OpenSky Network API — Aviation Stress Indicator
 * Docs: https://openskynetwork.github.io/opensky-api/rest.html
 *
 * No API key required for anonymous access (rate limited but sufficient for daily scans).
 * Optional: set OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET for higher rate limits.
 *
 * Measures two signals over European airspace:
 *   1. Emergency squawks (7700/7600/7500) — direct stress indicator
 *   2. Elevated aircraft density over conflict-adjacent zones
 *
 * Returns a KriResult for use in the CII Security component.
 */

import { prisma } from "./prisma";
import type { KriResult } from "./gdelt";

const API_BASE = "https://opensky-network.org/api";

// ---------------------------------------------------------------------------
// European bounding box (covers EU + Ukraine/Russia border + Balkans + Turkey)
// ---------------------------------------------------------------------------
const EU_BBOX = { lamin: 35, lomin: -15, lamax: 72, lomax: 45 };

// Conflict-adjacent zones — elevated weight when traffic is concentrated here
const CONFLICT_ZONES = [
  { name: "Ukraine border",   lamin: 47, lomin: 22, lamax: 53, lomax: 40 },
  { name: "Kaliningrad",      lamin: 53, lomin: 18, lamax: 56, lomax: 23 },
  { name: "Balkans",          lamin: 40, lomin: 13, lamax: 47, lomax: 25 },
  { name: "Caucasus",         lamin: 38, lomin: 38, lamax: 44, lomax: 50 },
  { name: "Eastern Med",      lamin: 33, lomin: 25, lamax: 38, lomax: 38 },
];

// Emergency squawk codes
const EMERGENCY_SQUAWKS = new Set(["7700", "7600", "7500"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// OpenSky state vector (index-based array)
type StateVector = [
  string,        // 0  icao24
  string | null, // 1  callsign
  string,        // 2  origin_country
  number | null, // 3  time_position
  number,        // 4  last_contact
  number | null, // 5  longitude
  number | null, // 6  latitude
  number | null, // 7  baro_altitude
  boolean,       // 8  on_ground
  number | null, // 9  velocity
  number | null, // 10 true_track
  number | null, // 11 vertical_rate
  number[] | null, // 12 sensors
  number | null, // 13 geo_altitude
  string | null, // 14 squawk
  boolean,       // 15 spi
  number,        // 16 position_source
  number,        // 17 category
];

interface OpenSkyResponse {
  time:   number;
  states: StateVector[] | null;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function buildAuthHeader(): Record<string, string> {
  const id     = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (id && secret) {
    return { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` };
  }
  return {};
}

async function fetchStates(): Promise<StateVector[]> {
  const id     = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;

  // Anonymous access is blocked by cloud datacenter IPs — require credentials on Vercel
  if (!id || !secret) {
    throw new Error(
      "OpenSky: OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are required " +
      "(anonymous access is blocked for cloud IPs). Register free at opensky-network.org"
    );
  }

  const { lamin, lomin, lamax, lomax } = EU_BBOX;
  const url = `${API_BASE}/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      headers: buildAuthHeader(),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenSky API error (${res.status}): ${text}`);
    }

    const json: OpenSkyResponse = await res.json();
    return json.states ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function isInZone(
  lon: number | null,
  lat: number | null,
  zone: { lamin: number; lomin: number; lamax: number; lomax: number }
): boolean {
  if (lon === null || lat === null) return false;
  return lat >= zone.lamin && lat <= zone.lamax && lon >= zone.lomin && lon <= zone.lomax;
}

interface AviationSignals {
  emergencyCount:     number; // aircraft with 7700/7600/7500 squawk
  conflictZoneCount:  number; // airborne aircraft over conflict zones
  totalEuAirborne:    number; // total airborne aircraft in EU bbox
}

function analyzeStates(states: StateVector[]): AviationSignals {
  let emergencyCount    = 0;
  let conflictZoneCount = 0;
  let totalEuAirborne   = 0;

  for (const s of states) {
    const onGround = s[8];
    const squawk   = s[14];
    const lon      = s[5];
    const lat      = s[6];

    if (onGround) continue; // only airborne

    totalEuAirborne++;

    if (squawk && EMERGENCY_SQUAWKS.has(squawk)) {
      emergencyCount++;
    }

    if (CONFLICT_ZONES.some((z) => isInZone(lon, lat, z))) {
      conflictZoneCount++;
    }
  }

  return { emergencyCount, conflictZoneCount, totalEuAirborne };
}

// ---------------------------------------------------------------------------
// Composite stress score (0–100)
// ---------------------------------------------------------------------------

function computeStressScore(signals: AviationSignals): number {
  // Emergency squawks: each one is a serious signal → weight heavily
  // Reference: 3+ emergencies simultaneously = very unusual
  const emergencyScore = Math.min(60, signals.emergencyCount * 20);

  // Conflict zone density: compare to total EU airborne as ratio
  // Reference: >5% of EU airborne in conflict zones = elevated
  const conflictRatio = signals.totalEuAirborne > 0
    ? signals.conflictZoneCount / signals.totalEuAirborne
    : 0;
  const conflictScore = Math.min(40, Math.round(conflictRatio * 400)); // 10% ratio → score 40

  return Math.min(100, emergencyScore + conflictScore);
}

// ---------------------------------------------------------------------------
// Sparkline from DB history (same pattern as worldmonitor.ts)
// ---------------------------------------------------------------------------

async function buildSparklineFromDb(): Promise<{
  sparkline:    number[];
  volume7dPrev: number;
  avgDaily:     number;
}> {
  const past = await prisma.kriMeasurement.findMany({
    where:   { key: "opensky_aviation_stress" },
    orderBy: { createdAt: "desc" },
    take:    30,
    select:  { score: true },
  });

  if (past.length === 0) {
    return { sparkline: [], volume7dPrev: 0, avgDaily: 0 };
  }

  const sparkline   = past.map((m) => Math.round(m.score)).reverse();
  const avgDaily    = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;
  const volume7dPrev = sparkline[0] ?? 0;

  return { sparkline, volume7dPrev, avgDaily: Math.round(avgDaily * 10) / 10 };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function measureOpenSkyKri(): Promise<KriResult> {
  const [states, history] = await Promise.all([
    fetchStates(),
    buildSparklineFromDb(),
  ]);

  const signals = analyzeStates(states);
  const score   = computeStressScore(signals);

  const trendPct =
    history.volume7dPrev > 0
      ? Math.round(((score - history.volume7dPrev) / history.volume7dPrev) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  return {
    key:          "opensky_aviation_stress",
    name:         "Aviation Stress · Europe (OpenSky)",
    category:     "Geopolitical",
    volume7d:     signals.emergencyCount,      // raw emergency squawk count for display
    volume7dPrev: history.volume7dPrev,
    avgDaily:     history.avgDaily,
    score,
    trend,
    trendPct,
    sparkline:    history.sparkline,
  };
}
