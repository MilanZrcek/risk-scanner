/**
 * MeteoAlarm (EUMETNET) — EU weather warnings via public CAP Atom feeds.
 *
 * Each EU-27 member state has its own feed at:
 *   https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{country-slug}
 *
 * CAP severity levels:
 *   Extreme  → red    (score weight 4)
 *   Severe   → orange (score weight 2)
 *   Moderate → yellow (score weight 1)
 *   Minor    → green  (ignored — routine, not operationally relevant)
 */

import { prisma } from "./prisma";
import type { KriResult } from "./gdelt";

const FEED_BASE = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-";

// EU-27 slugs used by MeteoAlarm feeds
const EU_SLUGS: [string, string][] = [
  ["AT", "austria"],
  ["BE", "belgium"],
  ["BG", "bulgaria"],
  ["HR", "croatia"],
  ["CY", "cyprus"],
  ["CZ", "czech-republic"],
  ["DK", "denmark"],
  ["EE", "estonia"],
  ["FI", "finland"],
  ["FR", "france"],
  ["DE", "germany"],
  ["GR", "greece"],
  ["HU", "hungary"],
  ["IE", "ireland"],
  ["IT", "italy"],
  ["LV", "latvia"],
  ["LT", "lithuania"],
  ["LU", "luxembourg"],
  ["MT", "malta"],
  ["NL", "netherlands"],
  ["PL", "poland"],
  ["PT", "portugal"],
  ["RO", "romania"],
  ["SK", "slovakia"],
  ["SI", "slovenia"],
  ["ES", "spain"],
  ["SE", "sweden"],
];

const SEVERITY_WEIGHT: Record<string, number> = {
  extreme: 4,
  severe:  2,
  moderate: 1,
  minor:   0,
};

export interface MeteoWarning {
  country:  string;  // 2-letter ISO code, e.g. "DE"
  area:     string;  // region/area description
  event:    string;  // e.g. "frost", "wind", "rain"
  severity: string;  // extreme | severe | moderate
  sent:     string;  // ISO timestamp
}

export interface MeteoAlarmDetails {
  totalWarnings: number;
  redCount:      number;   // extreme
  orangeCount:   number;   // severe
  yellowCount:   number;   // moderate
  warnings:      MeteoWarning[];
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m?.[1]?.trim() ?? "";
}

function parseCountryFeed(countryCode: string, xml: string): MeteoWarning[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const warnings: MeteoWarning[] = [];

  for (const entry of entries) {
    const severity = extractTag(entry, "cap:severity").toLowerCase();
    if (!severity || severity === "minor" || severity === "unknown") continue;

    warnings.push({
      country:  countryCode,
      area:     extractTag(entry, "cap:areaDesc"),
      event:    extractTag(entry, "cap:event"),
      severity: severity === "extreme" ? "extreme"
               : severity === "severe" ? "severe"
               : "moderate",
      sent:     extractTag(entry, "cap:sent"),
    });
  }

  return warnings;
}

async function fetchCountryWarnings(countryCode: string, slug: string): Promise<MeteoWarning[]> {
  try {
    const res = await fetch(`${FEED_BASE}${slug}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; risk-scanner)" },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseCountryFeed(countryCode, xml);
  } catch {
    return [];
  }
}

export async function measureMeteoAlarmKri(): Promise<KriResult> {
  // Fetch all 27 EU country feeds in parallel
  const results = await Promise.allSettled(
    EU_SLUGS.map(([code, slug]) => fetchCountryWarnings(code, slug))
  );

  const warnings: MeteoWarning[] = results
    .flatMap((r) => r.status === "fulfilled" ? r.value : [])
    .sort((a, b) => {
      const order = { extreme: 0, severe: 1, moderate: 2 };
      return (order[a.severity as keyof typeof order] ?? 3) -
             (order[b.severity as keyof typeof order] ?? 3);
    });

  const redCount    = warnings.filter((w) => w.severity === "extreme").length;
  const orangeCount = warnings.filter((w) => w.severity === "severe").length;
  const yellowCount = warnings.filter((w) => w.severity === "moderate").length;
  const volume7d    = warnings.length;

  // Weighted score: 5 extreme warnings → score 100
  const weightedScore = redCount * 4 + orangeCount * 2 + yellowCount;
  const REFERENCE_SCORE = 20;
  const score = Math.min(100, Math.round((weightedScore / REFERENCE_SCORE) * 100));

  // Trend from DB history
  const history = await prisma.kriMeasurement.findMany({
    where:   { key: "meteoalarm_warnings" },
    orderBy: { createdAt: "desc" },
    take:    30,
    select:  { volume7d: true },
  });

  const volume7dPrev = history[0]?.volume7d ?? 0;
  const trendPct = volume7dPrev > 0
    ? Math.round(((volume7d - volume7dPrev) / volume7dPrev) * 100)
    : 0;
  const trend: KriResult["trend"] =
    trendPct >= 20 ? "rising" : trendPct <= -20 ? "falling" : "stable";

  const historicVolumes = history.slice(0, 29).map((m) => m.volume7d).reverse();
  const sparkline = [...historicVolumes, volume7d].slice(-30);
  while (sparkline.length < 30) sparkline.unshift(0);
  const avgDaily = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;

  const details: MeteoAlarmDetails = {
    totalWarnings: volume7d,
    redCount,
    orangeCount,
    yellowCount,
    warnings,
  };

  return {
    key:          "meteoalarm_warnings",
    name:         "Weather Warnings · EU (MeteoAlarm)",
    category:     "Operational",
    volume7d,
    volume7dPrev,
    avgDaily:     Math.round(avgDaily * 10) / 10,
    score,
    trend,
    trendPct,
    sparkline,
    details,
  };
}
