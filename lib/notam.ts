/**
 * SkyLink NOTAM API via RapidAPI — Global Airspace Restrictions KRI
 * Endpoint: GET https://skylink-api.p.rapidapi.com/notams/{icao}
 * Free tier: 1 000 req/month (25 FIRs × 30 days = 750 req/month)
 *
 * Env: RAPIDAPI_KEY
 *
 * Monitors globally significant FIRs for active airspace restrictions.
 * Returns KriResult + structured details of new vs. ongoing restrictions.
 */

import { prisma } from "./prisma";
import type { KriResult } from "./gdelt";

const API_BASE = "https://skylink-api.p.rapidapi.com";

// ---------------------------------------------------------------------------
// Global FIR list — ordered by geopolitical significance
// Tier 3 = active conflict zone
// Tier 2 = high tension / adjacent to conflict
// Tier 1 = elevated watch
// ---------------------------------------------------------------------------
const FIRS = [
  { icao: "UKBV", name: "Kyiv FIR (Ukraine)"            },
  { icao: "UKOV", name: "Odessa FIR (Ukraine)"           },
  { icao: "LLLL", name: "Tel Aviv FIR (Israel)"          },
  { icao: "OYSC", name: "Sana'a FIR (Yemen)"             },
  { icao: "HSSS", name: "Khartoum FIR (Sudan)"           },
  { icao: "VYYY", name: "Yangon FIR (Myanmar)"           },
  { icao: "EPWW", name: "Warsaw FIR (Poland)"            },
  { icao: "LRBB", name: "Bucharest FIR (Romania)"        },
  { icao: "LUUU", name: "Chisinau FIR (Moldova)"         },
  { icao: "UGTB", name: "Tbilisi FIR (Georgia)"          },
  { icao: "OIIX", name: "Tehran FIR (Iran)"              },
  { icao: "HLLL", name: "Tripoli FIR (Libya)"            },
  { icao: "HCSM", name: "Mogadishu FIR (Somalia)"        },
  { icao: "OPKR", name: "Karachi FIR (Pakistan)"         },
  { icao: "RKRR", name: "Seoul FIR (South Korea)"        },
  { icao: "ZGZU", name: "Guangzhou FIR (China/Taiwan)"   },
  { icao: "LTAA", name: "Ankara FIR (Turkey)"            },
  { icao: "LYBA", name: "Belgrade FIR (Serbia)"          },
  { icao: "LBSR", name: "Sofia FIR (Bulgaria)"           },
  { icao: "LCLC", name: "Nicosia FIR (Cyprus)"           },
  { icao: "DFFD", name: "Ouagadougou FIR (Burkina Faso)" },
  { icao: "HAAB", name: "Addis Ababa FIR (Ethiopia)"     },
  { icao: "RJJJ", name: "Fukuoka FIR (Japan/NKorea)"     },
  { icao: "VIDF", name: "Delhi FIR (India)"              },
  { icao: "VVHM", name: "Ho Chi Minh FIR (Vietnam/SCS)" },
];

// ---------------------------------------------------------------------------
// Restriction patterns — what counts as a geopolitically significant NOTAM
// ---------------------------------------------------------------------------
const RESTRICTION_PATTERNS = [
  /use of airspace.{0,80}prohibit/i,
  /airspace.{0,40}(prohibit|clos)/i,
  /flight.{0,40}prohibit/i,
  /prohibit.{0,40}flight/i,
  /no.{0,10}fly zone/i,
  /military invasion/i,
  /military occupation/i,
  /armed conflict/i,
  /area of conflict/i,
  /ukraine crisis/i,
  /war zone/i,
  /restricted area.{0,60}activ/i,
  /prohibited area.{0,60}activ/i,
  /airspace closed/i,
  /closure of airspace/i,
  /fir\s+(closed|clos)/i,
  /flt.{0,20}suspended/i,
  /flights?.{0,20}suspended/i,
  /hostilities/i,
];

// Exclude routine/non-geopolitical NOTAMs
const EXCLUSION_PATTERNS = [
  /\bu\/s\b/i,                        // unserviceable nav-aid
  /due to maint/i,                     // maintenance
  /rwy.{0,20}(clsd|closed)/i,         // runway closed
  /twy.{0,20}(clsd|closed)/i,         // taxiway closed
  /sports?\s+flt/i,                    // sports flights
  /\bpje\b/i,                          // parachute jump exercise
  /parachut/i,                         // parachuting
  /glider/i,
  /model aircraft/i,
  /fireworks/i,
  /air show/i,
  /balloon/i,
  /\bfrng\b/i,                         // firing range
  /demolition of explosives/i,
  /danger area.{0,60}activ/i,          // generic danger area (too noisy)
  /mil\s+exer/i,                       // military exercise
  /military\s+exercise/i,
  /military\s+training/i,
  /exercise\s+area/i,
  /unmanned\s+acft\s+flt/i,           // routine drone ops
  /uav\s+ops/i,
  /drone\s+ops/i,
  /special\s+flt\s+will\s+take\s+place/i, // generic special flight
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkyLinkNotam {
  raw:        string;
  notam_id:   string | null;
  type:       string | null;
  location:   string | null;
  effective:  string | null;
  expiration: string | null;
  body:       string | null;
}

interface SkyLinkResponse {
  icao:   string;
  notams: SkyLinkNotam[];
  total:  number;
}

export interface NotamDetail {
  id:        string;
  fir:       string;
  firName:   string;
  tier:      number;
  text:      string;
  effective: string | null;
  expiry:    string | null;
  isNew:     boolean;  // not in previous scan
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchNotams(icao: string, apiKey: string): Promise<SkyLinkNotam[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/notams/${icao}`, {
      headers: {
        "X-RapidAPI-Key":  apiKey,
        "X-RapidAPI-Host": "skylink-api.p.rapidapi.com",
      },
      signal: controller.signal,
    });
  } catch {
    console.warn(`NOTAM fetch timed out or failed for ${icao}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    console.warn(`NOTAM fetch failed for ${icao}: ${res.status}`);
    return [];
  }

  const json: SkyLinkResponse = await res.json();
  return json.notams ?? [];
}

// Parse NOTAM date format: YYYYMMDDHHmm[TZ]
// Returns null if the string can't be parsed (treat as non-expired).
function parseNotamDate(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(EST|EDT|CST|CDT|MST|MDT|PST|PDT)?/i);
  if (!m) return null;
  const [, y, mo, d, h, mi, tz] = m;
  // Offset to UTC: EST=-5h, EDT=-4h, others treated as UTC
  const offsetH =
    /^EST$/i.test(tz ?? "") ? 5 :
    /^EDT$/i.test(tz ?? "") ? 4 :
    /^CST$/i.test(tz ?? "") ? 6 :
    /^CDT$/i.test(tz ?? "") ? 5 :
    /^MST$/i.test(tz ?? "") ? 7 :
    /^MDT$/i.test(tz ?? "") ? 6 :
    /^PST$/i.test(tz ?? "") ? 8 :
    /^PDT$/i.test(tz ?? "") ? 7 : 0;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h + offsetH, +mi));
}

function isExpired(expiration: string | null): boolean {
  const exp = parseNotamDate(expiration);
  if (!exp) return false; // no expiry = permanent, keep
  return exp < new Date();
}

function isRestrictionNotam(notam: SkyLinkNotam): boolean {
  if (isExpired(notam.expiration)) return false;
  const text = `${notam.raw} ${notam.body ?? ""}`;
  if (EXCLUSION_PATTERNS.some((p) => p.test(text))) return false;
  return RESTRICTION_PATTERNS.some((p) => p.test(text));
}

// Tier derived from NOTAM content — no hardcoded country judgments
// tier 3 = airspace closed / active conflict declaration
// tier 1 = caution / restriction notice
const TIER3_PATTERNS = [
  /fir\s+(closed|clos)/i,
  /flt.{0,20}suspended/i,
  /flights?.{0,20}suspended/i,
  /airspace\s+(closed|clos)/i,
  /closure of airspace/i,
  /military invasion/i,
  /military occupation/i,
  /armed conflict/i,
  /war zone/i,
  /hostilities/i,
];

function classifyTier(text: string): 3 | 1 {
  return TIER3_PATTERNS.some((p) => p.test(text)) ? 3 : 1;
}

// ---------------------------------------------------------------------------
// Previous scan — load NOTAM IDs to detect new ones
// ---------------------------------------------------------------------------

async function loadPreviousNotamIds(): Promise<Set<string>> {
  const prev = await prisma.kriMeasurement.findFirst({
    where:   { key: "notam_restrictions" },
    orderBy: { createdAt: "desc" },
    select:  { details: true },
  });

  if (!prev?.details) return new Set();

  try {
    const details: NotamDetail[] = JSON.parse(prev.details);
    return new Set(details.map((d) => d.id));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

function computeScore(details: NotamDetail[]): number {
  let weightedSum = 0;
  const byFir = new Map<string, { tier: number; count: number }>();

  for (const d of details) {
    const entry = byFir.get(d.fir) ?? { tier: d.tier, count: 0 };
    entry.count++;
    byFir.set(d.fir, entry);
  }

  for (const { tier, count } of byFir.values()) {
    weightedSum += Math.min(count, 20) * tier * 5;
  }

  // Reference: full Ukraine closure + conflict zones globally ≈ 400
  return Math.min(100, Math.round(weightedSum / 4));
}

// ---------------------------------------------------------------------------
// Sparkline from DB history
// ---------------------------------------------------------------------------

async function buildSparklineFromDb(): Promise<{
  sparkline:    number[];
  volume7dPrev: number;
  avgDaily:     number;
}> {
  const past = await prisma.kriMeasurement.findMany({
    where:   { key: "notam_restrictions" },
    orderBy: { createdAt: "desc" },
    take:    30,
    select:  { score: true, volume7d: true },
  });

  if (past.length === 0) return { sparkline: [], volume7dPrev: 0, avgDaily: 0 };

  const sparkline    = past.map((m) => Math.round(m.score)).reverse();
  const avgDaily     = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;
  const volume7dPrev = past[1]?.volume7d ?? 0;

  return { sparkline, volume7dPrev, avgDaily: Math.round(avgDaily * 10) / 10 };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function measureNotamKri(): Promise<KriResult & { details: NotamDetail[] }> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY must be set");

  const [firResults, prevIds, history] = await Promise.all([
    Promise.all(
      FIRS.map(async (fir) => {
        const notams       = await fetchNotams(fir.icao, apiKey);
        const restrictions = notams.filter(isRestrictionNotam);
        return { fir, restrictions };
      })
    ),
    loadPreviousNotamIds(),
    buildSparklineFromDb(),
  ]);

  // Build flat detail list
  const details: NotamDetail[] = [];
  for (const { fir, restrictions } of firResults) {
    for (const n of restrictions) {
      const text = n.raw.replace(/\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      const id = `${fir.icao}:${n.notam_id ?? n.raw.slice(0, 30)}`;
      details.push({
        id,
        fir:      fir.icao,
        firName:  fir.name,
        tier:     classifyTier(`${n.raw} ${n.body ?? ""}`),
        text,
        effective: n.effective ?? null,
        expiry:    n.expiration ?? null,
        isNew:    !prevIds.has(id),
      });
    }
  }

  // Sort: newest issued first, then tier desc
  details.sort((a, b) =>
    (b.effective ?? "").localeCompare(a.effective ?? "") ||
    b.tier - a.tier
  );

  const score  = computeScore(details);
  const volume = details.length;

  const trendPct =
    history.volume7dPrev > 0
      ? Math.round(((volume - history.volume7dPrev) / history.volume7dPrev) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  return {
    key:          "notam_restrictions",
    name:         "Airspace Restrictions · Global (NOTAM)",
    category:     "Geopolitical",
    volume7d:     volume,
    volume7dPrev: history.volume7dPrev,
    avgDaily:     history.avgDaily,
    score,
    trend,
    trendPct,
    sparkline:    history.sparkline,
    details,
  };
}
