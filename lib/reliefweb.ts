/**
 * ReliefWeb API integration
 * Docs: https://apidoc.reliefweb.int
 *
 * No auth needed — only an approved appname (env: RELIEFWEB_APPNAME).
 * Produces two KriResults:
 *   1. reliefweb_crises   — Humanitarian Crisis Count (new ongoing disasters)
 *   2. reliefweb_severity — Disaster Severity Index (type-weighted)
 */

import type { KriResult } from "./gdelt";

const API_BASE = "https://api.reliefweb.int/v2";

// ---------------------------------------------------------------------------
// Severity weights by disaster type (higher = worse for EU risk picture)
// ---------------------------------------------------------------------------
const SEVERITY_WEIGHTS: Record<string, number> = {
  "Complex Emergency":  10,
  "Conflict":           10,
  "Epidemic":            9,
  "Earthquake":          8,
  "Tsunami":             8,
  "Tropical Cyclone":    7,
  "Volcano":             7,
  "Drought":             6,
  "Industrial Accident": 6,
  "Landslide":           5,
  "Flood":               5,
  "Heat Wave":           4,
  "Cold Wave":           4,
  "Other":               3,
};

function severityWeight(types: string[]): number {
  if (types.length === 0) return SEVERITY_WEIGHTS["Other"];
  return Math.max(...types.map((t) => SEVERITY_WEIGHTS[t] ?? SEVERITY_WEIGHTS["Other"]));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RwDisasterFields {
  name:   string;
  date:   { created: string };          // ISO string
  status: string;                        // "ongoing" | "past" | "alert"
  type?:  { name: string }[];
}

interface RwDisaster {
  id:     number;
  fields: RwDisasterFields;
}

interface RwResponse {
  data:      RwDisaster[];
  totalCount: number;
}

export interface ReliefWebDisasterDetail {
  id:       number;
  name:     string;
  types:    string[];
  status:   string;
  date:     string;   // YYYY-MM-DD
  severity: number;   // highest type weight
}

export interface ReliefWebDetails {
  disasters:  ReliefWebDisasterDetail[];
  fetchedAt:  string;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function fetchDisasters(
  appname:  string,
  fromDate: string,
  toDate:   string
): Promise<RwDisaster[]> {
  const url = `${API_BASE}/disasters?appname=${encodeURIComponent(appname)}`;

  const body = {
    limit: 1000,
    fields: {
      include: ["name", "date.created", "status", "type"],
    },
    filter: {
      operator: "AND",
      conditions: [
        // Only ongoing and alert-level disasters (not past/resolved)
        {
          field:    "status",
          value:    ["ongoing", "alert"],
          operator: "OR",
        },
        // Created within our fetch window
        {
          field: "date.created",
          value: { from: `${fromDate}T00:00:00+00:00`, to: `${toDate}T23:59:59+00:00` },
        },
      ],
    },
    sort: ["date.created:desc"],
  };

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ReliefWeb API error (${res.status}): ${text}`);
  }

  const json: RwResponse = await res.json();
  return json.data ?? [];
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function countByDay(disasters: RwDisaster[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of disasters) {
    const day = d.fields.date.created.split("T")[0];
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return map;
}

function severityByDay(disasters: RwDisaster[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of disasters) {
    const day    = d.fields.date.created.split("T")[0];
    const types  = (d.fields.type ?? []).map((t) => t.name);
    const weight = severityWeight(types);
    map.set(day, (map.get(day) ?? 0) + weight);
  }
  return map;
}

function sumRange(byDay: Map<string, number>, startDate: Date, days: number): number {
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    total += byDay.get(formatDate(d)) ?? 0;
  }
  return total;
}

function buildSparkline(byDay: Map<string, number>, startDate: Date, days: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    result.push(byDay.get(formatDate(d)) ?? 0);
  }
  return result;
}

// ---------------------------------------------------------------------------
// KRI builders
// ---------------------------------------------------------------------------

function buildDetails(disasters: RwDisaster[], windowStart: Date): ReliefWebDetails {
  const details: ReliefWebDisasterDetail[] = disasters
    .filter((d) => new Date(d.fields.date.created) >= windowStart)
    .map((d) => {
      const types = (d.fields.type ?? []).map((t) => t.name);
      return {
        id:       d.id,
        name:     d.fields.name,
        types,
        status:   d.fields.status,
        date:     d.fields.date.created.split("T")[0],
        severity: severityWeight(types),
      };
    })
    .sort((a, b) => b.severity - a.severity || a.date.localeCompare(b.date) * -1);
  return { disasters: details, fetchedAt: new Date().toISOString() };
}

function buildCrisisCountKri(disasters: RwDisaster[], today: Date): KriResult & { details: ReliefWebDetails } {
  const byDay = countByDay(disasters);

  const window7Start = new Date(today);
  window7Start.setDate(window7Start.getDate() - 7);

  const prevStart = new Date(today);
  prevStart.setDate(prevStart.getDate() - 14);

  const sparklineStart = new Date(today);
  sparklineStart.setDate(sparklineStart.getDate() - 30);

  const volume7d     = sumRange(byDay, window7Start, 7);
  const volume7dPrev = sumRange(byDay, prevStart,    7);
  const sparkline    = buildSparkline(byDay, sparklineStart, 30);
  const avgDaily     = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;

  const trendPct =
    volume7dPrev > 0
      ? Math.round(((volume7d - volume7dPrev) / volume7dPrev) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  // Reference: 15 new crises/7 days = score 100
  const REFERENCE = 15;
  const score = Math.min(100, Math.round((volume7d / REFERENCE) * 100));

  return {
    key:          "reliefweb_crises",
    name:         "Humanitarian Crises · New (ReliefWeb)",
    category:     "Geopolitical",
    volume7d,
    volume7dPrev,
    avgDaily:     Math.round(avgDaily * 10) / 10,
    score,
    trend,
    trendPct,
    sparkline,
    details:      buildDetails(disasters, window7Start),
  };
}

function buildSeverityIndexKri(disasters: RwDisaster[], today: Date): KriResult & { details: ReliefWebDetails } {
  const byDay = severityByDay(disasters);

  const window7Start = new Date(today);
  window7Start.setDate(window7Start.getDate() - 7);

  const prevStart = new Date(today);
  prevStart.setDate(prevStart.getDate() - 14);

  const sparklineStart = new Date(today);
  sparklineStart.setDate(sparklineStart.getDate() - 30);

  const volume7d     = sumRange(byDay, window7Start, 7);
  const volume7dPrev = sumRange(byDay, prevStart,    7);
  const sparkline    = buildSparkline(byDay, sparklineStart, 30);
  const avgDaily     = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;

  const trendPct =
    volume7dPrev > 0
      ? Math.round(((volume7d - volume7dPrev) / volume7dPrev) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  // Reference: severity sum of 100 per 7 days = score 100
  const REFERENCE = 100;
  const score = Math.min(100, Math.round((volume7d / REFERENCE) * 100));

  return {
    key:          "reliefweb_severity",
    name:         "Disaster Severity Index (ReliefWeb)",
    category:     "Geopolitical",
    volume7d,
    volume7dPrev,
    avgDaily:     Math.round(avgDaily * 10) / 10,
    score,
    trend,
    trendPct,
    sparkline,
    details:      buildDetails(disasters, window7Start),
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function measureReliefWebKris(): Promise<KriResult[]> {
  const appname = process.env.RELIEFWEB_APPNAME;
  if (!appname) throw new Error("RELIEFWEB_APPNAME must be set in environment variables");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch 44 days to cover: 30-day sparkline + 7-day current + 7-day prev windows
  const fetchFrom = new Date(today);
  fetchFrom.setDate(fetchFrom.getDate() - 44);

  const disasters = await fetchDisasters(appname, formatDate(fetchFrom), formatDate(today));

  return [
    buildCrisisCountKri(disasters, today),
    buildSeverityIndexKri(disasters, today),
  ];
}
