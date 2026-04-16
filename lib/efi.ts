/**
 * Extreme Forecast Index (EFI) approximation via Open-Meteo (free, no API key).
 *
 * Open-Meteo uses ECMWF IFS as its primary model for European forecasts.
 * We compute a z-score based EFI proxy:
 *   EFI ≈ (forecast_value − baseline_mean) / baseline_std
 * using the past 30 days as the rolling model climate baseline,
 * capped and normalised to [0, 1].
 *
 * Cities monitored: Brussels, Prague, Bratislava, Budapest, Bucharest
 * (KBC Group's primary markets).
 *
 * Variables: temperature max, precipitation, wind speed max.
 */

import { prisma } from "./prisma";
import type { KriResult } from "./gdelt";

interface OpenMeteoResponse {
  daily: {
    time:                  string[];
    temperature_2m_max:    (number | null)[];
    precipitation_sum:     (number | null)[];
    wind_speed_10m_max:    (number | null)[];
  };
}

const CITIES = [
  { code: "BRU", name: "Brussels",   lat: 50.85, lon:  4.35 },
  { code: "PRG", name: "Prague",     lat: 50.08, lon: 14.42 },
  { code: "BTS", name: "Bratislava", lat: 48.15, lon: 17.11 },
  { code: "BUD", name: "Budapest",   lat: 47.50, lon: 19.08 },
  { code: "OTP", name: "Bucharest",  lat: 44.43, lon: 26.10 },
] as const;

export interface EfiCityData {
  code:      string;
  name:      string;
  efi:       number;       // 0–1, max EFI over next 7 days
  efiTemp:   number;       // temperature component (current day)
  efiPrecip: number;       // precipitation component
  efiWind:   number;       // wind component
  forecast:  number[];     // 7-day EFI trend (one value per day)
}

export interface EfiDetails {
  cities:      EfiCityData[];
  maxEfi:      number;
  maxEfiCity:  string;
  fetchedAt:   string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defined(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && isFinite(v));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 1;
  const m  = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance) || 1;
}

/** z-score capped at ±3, then mapped to 0–1 (0 = normal, 1 = extreme). */
function efiScore(baselineVals: number[], forecastVal: number | null): number {
  if (forecastVal === null || !isFinite(forecastVal)) return 0;
  const z = (forecastVal - mean(baselineVals)) / std(baselineVals);
  return Math.min(1, Math.abs(z) / 3);
}

// ---------------------------------------------------------------------------
// Fetch one city
// ---------------------------------------------------------------------------

async function fetchCity(city: typeof CITIES[number]): Promise<EfiCityData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",       String(city.lat));
  url.searchParams.set("longitude",      String(city.lon));
  url.searchParams.set("daily",          "temperature_2m_max,precipitation_sum,wind_speed_10m_max");
  url.searchParams.set("past_days",      "30");
  url.searchParams.set("forecast_days",  "7");
  url.searchParams.set("timezone",       "auto");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${city.name}: HTTP ${res.status}`);

  const data: OpenMeteoResponse = await res.json();
  const d = data.daily;
  const n = d.time.length; // 30 + 7 = 37

  // Split: first 30 days = baseline, last 7 = forecast
  const baselineEnd = n - 7;
  const bl_temp   = defined(d.temperature_2m_max.slice(0, baselineEnd));
  const bl_precip = defined(d.precipitation_sum .slice(0, baselineEnd));
  const bl_wind   = defined(d.wind_speed_10m_max.slice(0, baselineEnd));

  const fc_temp   = d.temperature_2m_max.slice(baselineEnd);
  const fc_precip = d.precipitation_sum .slice(baselineEnd);
  const fc_wind   = d.wind_speed_10m_max.slice(baselineEnd);

  // Per-day combined EFI for each forecast day
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const t = efiScore(bl_temp,   fc_temp[i]);
    const p = efiScore(bl_precip, fc_precip[i]);
    const w = efiScore(bl_wind,   fc_wind[i]);
    return Math.round(Math.max(t, p, w) * 100) / 100;
  });

  const efi = Math.max(...forecast);

  return {
    code:      city.code,
    name:      city.name,
    efi,
    efiTemp:   efiScore(bl_temp,   fc_temp[0]),
    efiPrecip: efiScore(bl_precip, fc_precip[0]),
    efiWind:   efiScore(bl_wind,   fc_wind[0]),
    forecast,
  };
}

// ---------------------------------------------------------------------------
// Public KRI function
// ---------------------------------------------------------------------------

export async function measureEfiKri(): Promise<KriResult> {
  const settled = await Promise.allSettled(CITIES.map(fetchCity));
  const cities  = settled
    .filter((r): r is PromiseFulfilledResult<EfiCityData> => r.status === "fulfilled")
    .map((r) => r.value);

  if (cities.length === 0) throw new Error("EFI: failed to fetch data for all cities");

  const maxEfi     = Math.max(...cities.map((c) => c.efi));
  const maxEfiCity = cities.find((c) => c.efi === maxEfi)?.name ?? "";
  const score      = Math.round(maxEfi * 100);

  const trendPct = 0; // EFI is a forecast metric; we compare across days, not periods
  const trend: KriResult["trend"] =
    score >= 70 ? "rising" : score >= 30 ? "stable" : "falling";

  // Sparkline: max EFI across cities for each of the next 7 days, padded to 30
  const dailyMax = Array.from({ length: 7 }, (_, i) =>
    Math.round(Math.max(...cities.map((c) => c.forecast[i] ?? 0)) * 100)
  );

  // Load history to fill sparkline with past values
  const history = await prisma.kriMeasurement.findMany({
    where:   { key: "weather_efi" },
    orderBy: { createdAt: "desc" },
    take:    23,
    select:  { score: true },
  });
  const pastScores = history.map((m) => Math.round(m.score)).reverse();
  const sparkline  = [...pastScores, ...dailyMax.slice(0, 30 - pastScores.length)].slice(-30);
  while (sparkline.length < 30) sparkline.unshift(0);

  const avgDaily = sparkline.reduce((s, v) => s + v, 0) / sparkline.length;

  const details: EfiDetails = {
    cities,
    maxEfi,
    maxEfiCity,
    fetchedAt: new Date().toISOString(),
  };

  return {
    key:          "weather_efi",
    name:         "Extreme Weather · Cities (EFI)",
    category:     "Operational",
    volume7d:     score,
    volume7dPrev: history[0] ? Math.round(history[0].score) : 0,
    avgDaily:     Math.round(avgDaily),
    score,
    trend,
    trendPct,
    sparkline,
    details,
  };
}
