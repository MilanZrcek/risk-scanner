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
  efiTemp:   number;       // temperature component
  efiPrecip: number;       // precipitation component
  efiWind:   number;       // wind component
  forecast:  number[];     // 7-day EFI trend (one value per day)
  // Actual values for interpretability
  tempMax:    number | null;  // peak forecast °C over 7 days
  tempMean:   number;         // 30-day baseline mean °C
  tempZ:      number;         // std deviations above baseline
  precipMax:  number | null;  // peak forecast mm over 7 days
  precipMean: number;         // 30-day baseline mean mm
  precipZ:    number;
  windMax:    number | null;  // peak forecast km/h over 7 days
  windMean:   number;         // 30-day baseline mean km/h
  windZ:      number;
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

// Minimum baseline std per variable — prevents near-zero variance during calm
// periods from inflating z-scores artificially (e.g. 4mm rain after a dry week).
const MIN_STD_TEMP   = 4;   // °C
const MIN_STD_PRECIP = 5;   // mm/day  (real extreme ≥ 30mm)
const MIN_STD_WIND   = 10;  // km/h    (storm-force winds > 60 km/h)

/** z-score capped at ±3, then mapped to 0–1 (0 = normal, 1 = extreme). */
function efiScore(baselineVals: number[], forecastVal: number | null, minStd = 1): number {
  if (forecastVal === null || !isFinite(forecastVal)) return 0;
  const s = Math.max(std(baselineVals), minStd);
  const z = (forecastVal - mean(baselineVals)) / s;
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
    const t = efiScore(bl_temp,   fc_temp[i],   MIN_STD_TEMP);
    const p = efiScore(bl_precip, fc_precip[i], MIN_STD_PRECIP);
    const w = efiScore(bl_wind,   fc_wind[i],   MIN_STD_WIND);
    return Math.round(Math.max(t, p, w) * 100) / 100;
  });

  const efi = Math.max(...forecast);

  // Actual peak forecast values for interpretability
  const validTemp   = fc_temp  .filter((v): v is number => v !== null && isFinite(v));
  const validPrecip = fc_precip.filter((v): v is number => v !== null && isFinite(v));
  const validWind   = fc_wind  .filter((v): v is number => v !== null && isFinite(v));

  const tempMax   = validTemp  .length > 0 ? Math.max(...validTemp)   : null;
  const precipMax = validPrecip.length > 0 ? Math.max(...validPrecip) : null;
  const windMax   = validWind  .length > 0 ? Math.max(...validWind)   : null;

  const blMeanTemp   = mean(bl_temp);
  const blMeanPrecip = mean(bl_precip);
  const blMeanWind   = mean(bl_wind);

  function zScore(baselineVals: number[], peakVal: number | null, minStd: number): number {
    if (peakVal === null) return 0;
    const s = Math.max(std(baselineVals), minStd);
    return Math.round(((peakVal - mean(baselineVals)) / s) * 10) / 10;
  }

  return {
    code:       city.code,
    name:       city.name,
    efi,
    efiTemp:    efiScore(bl_temp,   fc_temp[0],   MIN_STD_TEMP),
    efiPrecip:  efiScore(bl_precip, fc_precip[0], MIN_STD_PRECIP),
    efiWind:    efiScore(bl_wind,   fc_wind[0],   MIN_STD_WIND),
    forecast,
    tempMax,
    tempMean:   Math.round(blMeanTemp   * 10) / 10,
    tempZ:      zScore(bl_temp,   tempMax,   MIN_STD_TEMP),
    precipMax:  precipMax !== null ? Math.round(precipMax * 10) / 10 : null,
    precipMean: Math.round(blMeanPrecip * 10) / 10,
    precipZ:    zScore(bl_precip, precipMax, MIN_STD_PRECIP),
    windMax:    windMax   !== null ? Math.round(windMax   * 10) / 10 : null,
    windMean:   Math.round(blMeanWind   * 10) / 10,
    windZ:      zScore(bl_wind,   windMax,   MIN_STD_WIND),
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
