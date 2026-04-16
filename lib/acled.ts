/**
 * ACLED (Armed Conflict Location & Event Data) – free weekly Excel download
 *
 * ACLED publikuje každý týden agregovaný Excel soubor pro Evropu / Střední Asii
 * na adrese:
 *   https://acleddata.com/system/files/{YYYY-MM}/Europe-Central-Asia_aggregated_data_up_to_week_of-{YYYY-MM-DD}.xlsx
 *
 * Soubor je přístupný zaregistrovaným uživatelům (zdarma) po přihlášení přes
 * Drupal webový formulář. Přihlášení probíhá pomocí stejných přihlašovacích údajů
 * jako ACLED_EMAIL + ACLED_PASSWORD.
 *
 * Každý soubor obsahuje kumulativní součty událostí od začátku roku pro každou zemi.
 * KRI se počítá jako týdenní přírůstek (diff mezi soubory po sobě jdoucích týdnů).
 * Předchozí kumulativní součet je uložen v poli `details` předchozího KRI měření.
 */

import * as XLSX from "xlsx";
import { prisma } from "./prisma";
import type { KriResult } from "./gdelt";

const BASE_URL = "https://acleddata.com";

// ---------------------------------------------------------------------------
// URL discovery — probes recent Saturdays (ACLED data weeks end on Saturday)
// ---------------------------------------------------------------------------

function recentSaturdays(count: number): Date[] {
  const saturdays: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Walk back to the most recent Saturday (day 6)
  while (d.getDay() !== 6) d.setDate(d.getDate() - 1);
  for (let i = 0; i < count; i++) {
    saturdays.push(new Date(d));
    d.setDate(d.getDate() - 7);
  }
  return saturdays;
}

function isoDate(d: Date): string {
  // Use local date components — toISOString() would give UTC date which is
  // off by one on servers east of UTC (e.g. CEST UTC+2).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function padM(n: number): string {
  return String(((n - 1 + 12) % 12) + 1).padStart(2, "0");
}

/** Candidate URLs for a given Saturday (file may be published in same or next month). */
function candidateUrls(saturday: Date): string[] {
  const dateStr = isoDate(saturday);
  const year  = saturday.getFullYear();
  const month = saturday.getMonth() + 1; // JS months are 0-based
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;

  return [
    `${BASE_URL}/system/files/${year}-${String(month).padStart(2, "0")}/Europe-Central-Asia_aggregated_data_up_to_week_of-${dateStr}.xlsx`,
    `${BASE_URL}/system/files/${nextYear}-${String(nextMonth).padStart(2, "0")}/Europe-Central-Asia_aggregated_data_up_to_week_of-${dateStr}.xlsx`,
  ];
}

// ---------------------------------------------------------------------------
// Drupal web-login — returns session cookie string
// ---------------------------------------------------------------------------

async function getDrupalCookie(): Promise<string> {
  const email    = process.env.ACLED_EMAIL;
  const password = process.env.ACLED_PASSWORD;
  if (!email || !password) {
    throw new Error("ACLED_EMAIL and ACLED_PASSWORD must be set");
  }

  // 1) GET the login page — needed for CSRF form_build_id
  const pageRes = await fetch(`${BASE_URL}/user/login`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; risk-scanner)" },
  });
  const initCookies = pageRes.headers.get("set-cookie") ?? "";
  const html = await pageRes.text();

  const buildIdMatch = html.match(/name="form_build_id"\s+value="([^"]+)"/);
  if (!buildIdMatch) {
    throw new Error("ACLED login page: could not find form_build_id");
  }

  // 2) POST credentials — Drupal returns Set-Cookie with session token
  const body = new URLSearchParams({
    name:           email,
    pass:           password,
    form_build_id:  buildIdMatch[1],
    form_id:        "user_login_form",
    op:             "Log in",
  });

  const loginRes = await fetch(`${BASE_URL}/user/login`, {
    method:   "POST",
    redirect: "manual", // capture cookies before the redirect
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":   "Mozilla/5.0 (compatible; risk-scanner)",
      "Cookie":       initCookies,
    },
    body: body.toString(),
  });

  const setCookie = loginRes.headers.get("set-cookie") ?? "";

  // Drupal session cookie names start with SESS (HTTP) or SSESS (HTTPS)
  const sessionMatch = setCookie.match(/(S?SESS[^=]+=\S+?)(?:;|\s|$)/);
  if (!sessionMatch) {
    throw new Error(
      "ACLED Drupal login failed — no session cookie returned. " +
      "Check ACLED_EMAIL / ACLED_PASSWORD and that the account has free data access."
    );
  }

  return sessionMatch[1]; // e.g. "SESSabc123=xyz789"
}

// ---------------------------------------------------------------------------
// Find the latest published weekly Excel file
// ---------------------------------------------------------------------------

async function findLatestFileUrl(cookie: string): Promise<{ url: string; weekDate: string }> {
  const saturdays = recentSaturdays(8); // probe up to 8 weeks back

  for (const sat of saturdays) {
    for (const url of candidateUrls(sat)) {
      const res = await fetch(url, {
        method:   "HEAD",
        redirect: "follow",
        headers:  { Cookie: cookie, "User-Agent": "Mozilla/5.0 (compatible; risk-scanner)" },
      });
      console.info(`[ACLED] HEAD ${url} → ${res.status}`);
      if (res.status === 200) {
        return { url, weekDate: isoDate(sat) };
      }
    }
  }

  throw new Error(
    "Could not find a recent ACLED weekly Excel file after probing 8 Saturdays. " +
    "The URL pattern may have changed."
  );
}

// ---------------------------------------------------------------------------
// Parse Excel — returns total event count (sum across all rows / countries)
// ---------------------------------------------------------------------------

// EU-27 member states — names as used in ACLED data
const EU_COUNTRIES = new Set([
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus",
  "Czech Republic", "Czechia", "Denmark", "Estonia", "Finland",
  "France", "Germany", "Greece", "Hungary", "Ireland", "Italy",
  "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands",
  "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
  "Spain", "Sweden",
]);

export interface AcledCountryRow {
  country:    string;
  events:     number;
  fatalities: number;
}

export interface AcledEventTypeRow {
  eventType:  string;
  events:     number;
  fatalities: number;
}

export interface AcledDetails {
  weekDate:        string;
  fileUrl:         string;
  totalEvents:     number;
  totalFatalities: number;
  byCountry:       AcledCountryRow[];    // top 20, sorted by events desc
  byEventType:     AcledEventTypeRow[];  // all 6 types
}

function parseAcledExcel(buffer: ArrayBuffer): { totalEvents: number; fatalities: number; breakdown: Omit<AcledDetails, "weekDate" | "fileUrl"> } {
  const wb   = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: 0 });

  if (rows.length === 0) throw new Error("ACLED Excel file has no rows");

  // Structure: one row per WEEK / COUNTRY / ADMIN1 / EVENT_TYPE / SUB_EVENT_TYPE
  // The file contains ALL weeks up to the file date — filter to the latest WEEK serial only.
  const weekVals   = rows.map((r) => Number(r["WEEK"] ?? 0)).filter(isFinite);
  const latestWeek = Math.max(...weekVals);

  let totalEvents = 0;
  let totalFatal  = 0;
  let filteredRows = 0;

  const countryMap   = new Map<string, { events: number; fatalities: number }>();
  const eventTypeMap = new Map<string, { events: number; fatalities: number }>();

  for (const row of rows) {
    if (Number(row["WEEK"]) !== latestWeek) continue;

    const country   = String(row["COUNTRY"]    ?? row["country"]    ?? "Unknown");
    if (!EU_COUNTRIES.has(country)) continue;   // EU-27 only

    filteredRows++;
    const events    = Number(row["EVENTS"]     ?? row["events"]     ?? 0);
    const fatal     = Number(row["FATALITIES"] ?? row["fatalities"] ?? 0);
    const eventType = String(row["EVENT_TYPE"] ?? row["event_type"] ?? "Unknown");

    if (isFinite(events)) totalEvents += events;
    if (isFinite(fatal))  totalFatal  += fatal;

    // Accumulate by country
    const c = countryMap.get(country) ?? { events: 0, fatalities: 0 };
    c.events     += isFinite(events) ? events : 0;
    c.fatalities += isFinite(fatal)  ? fatal  : 0;
    countryMap.set(country, c);

    // Accumulate by event type
    const t = eventTypeMap.get(eventType) ?? { events: 0, fatalities: 0 };
    t.events     += isFinite(events) ? events : 0;
    t.fatalities += isFinite(fatal)  ? fatal  : 0;
    eventTypeMap.set(eventType, t);
  }

  const byCountry: AcledCountryRow[] = [...countryMap.entries()]
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 20);

  const byEventType: AcledEventTypeRow[] = [...eventTypeMap.entries()]
    .map(([eventType, v]) => ({ eventType, ...v }))
    .sort((a, b) => b.events - a.events);

  console.info(
    `[ACLED] ${rows.length} rows total, ${filteredRows} for week serial ${latestWeek}` +
    ` → ${totalEvents} events, ${totalFatal} fatalities`
  );

  return {
    totalEvents,
    fatalities: totalFatal,
    breakdown: { totalEvents, totalFatalities: totalFatal, byCountry, byEventType },
  };
}

// ---------------------------------------------------------------------------
// Public KRI function
// ---------------------------------------------------------------------------

export async function measureAcledKri(): Promise<KriResult> {
  // 1. Authenticate
  const cookie = await getDrupalCookie();

  // 2. Find and download latest weekly file
  const { url: fileUrl, weekDate } = await findLatestFileUrl(cookie);

  const fileRes = await fetch(fileUrl, {
    headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0 (compatible; risk-scanner)" },
  });
  if (!fileRes.ok) {
    throw new Error(`Failed to download ACLED file (${fileRes.status}): ${fileUrl}`);
  }
  const buffer = await fileRes.arrayBuffer();
  const { totalEvents, breakdown } = parseAcledExcel(buffer);

  // 3. Load history from DB — last 35 KRI measurements for this key
  const history = await prisma.kriMeasurement.findMany({
    where:   { key: "acled_violence" },
    orderBy: { createdAt: "desc" },
    take:    35,
    select:  { volume7d: true, details: true, createdAt: true },
  });

  // The file contains data for ONE week only — totalEvents is directly volume7d.
  // If the file hasn't changed since last scan (same weekDate), reuse last volume7d.
  const prevMeasurement = history[0];
  let prevWeekDate = "";
  if (prevMeasurement?.details) {
    try {
      prevWeekDate = (JSON.parse(prevMeasurement.details) as { weekDate?: string }).weekDate ?? "";
    } catch { /* ignore */ }
  }

  // Always prefer fresh data from the file; fall back to stored value only if parse gave 0
  const volume7d = totalEvents > 0 ? totalEvents : (prevMeasurement?.volume7d ?? 0);

  console.info(`[ACLED] weekDate=${weekDate}, prevWeek=${prevWeekDate || "none"}, totalEvents=${totalEvents}, volume7d=${volume7d}`);

  // Previous week: find most recent stored measurement with a different weekDate
  let volume7dPrev = 0;
  for (const m of history) {
    if (!m.details) continue;
    try {
      const d = JSON.parse(m.details) as { weekDate?: string };
      if (d.weekDate && d.weekDate !== weekDate) {
        volume7dPrev = m.volume7d;
        break;
      }
    } catch { /* ignore */ }
  }

  // Sparkline: last 30 volume7d values from DB + current
  const historicVolumes = history
    .slice(0, 29)
    .map((m) => m.volume7d)
    .reverse();
  const sparkline = [...historicVolumes, volume7d].slice(-30);
  while (sparkline.length < 30) sparkline.unshift(0);

  const avgDaily = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;

  // Trend
  const trendPct =
    volume7dPrev > 0
      ? Math.round(((volume7d - volume7dPrev) / volume7dPrev) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  // Score 0–100: 6 000 events/week = score 100 (≈ 2× observed Europe+Central Asia baseline ~3 000/week)
  const REFERENCE_EVENTS = 6_000;
  const score = Math.min(100, Math.round((volume7d / REFERENCE_EVENTS) * 100));

  return {
    key:      "acled_violence",
    name:     "Violence Events · EU (ACLED)",
    category: "Geopolitical",
    volume7d,
    volume7dPrev,
    avgDaily: Math.round(avgDaily * 10) / 10,
    score,
    trend,
    trendPct,
    sparkline,
    details: { weekDate, fileUrl, ...breakdown } satisfies AcledDetails,
  };
}
