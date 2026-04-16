"use client";

import { useState } from "react";
import { CATEGORY_COLORS } from "./CategoryFilter";

interface KriMeasurement {
  id: string;
  key: string;
  name: string;
  category: string;
  score: number;
  trend: string;
  trendPct: number;
  volume7d: number;
  sparkline: string;
  details?: string | null;
}

interface AcledCountryRow  { country: string;   events: number; fatalities: number; }
interface AcledEventTypeRow { eventType: string; events: number; fatalities: number; }
interface AcledDetails {
  weekDate:        string;
  totalEvents:     number;
  totalFatalities: number;
  byCountry:       AcledCountryRow[];
  byEventType:     AcledEventTypeRow[];
}

interface ReliefWebDisasterDetail {
  id:       number;
  name:     string;
  types:    string[];
  status:   string;
  date:     string;
  severity: number;
}
interface ReliefWebDetails {
  disasters: ReliefWebDisasterDetail[];
  fetchedAt: string;
}

interface MeteoWarning {
  country:  string;
  area:     string;
  event:    string;
  severity: "extreme" | "severe";
  sent:     string;
}
interface MeteoAlarmDetails {
  totalWarnings: number;
  redCount:      number;
  orangeCount:   number;
  warnings:      MeteoWarning[];
}

interface EfiCityData {
  code:       string;
  name:       string;
  efi:        number;
  efiTemp:    number;
  efiPrecip:  number;
  efiWind:    number;
  forecast:   number[];
  tempMax:    number | null;
  tempMean:   number;
  tempZ:      number;
  precipMax:  number | null;
  precipMean: number;
  precipZ:    number;
  windMax:    number | null;
  windMean:   number;
  windZ:      number;
}
interface EfiDetails {
  cities:     EfiCityData[];
  maxEfi:     number;
  maxEfiCity: string;
  fetchedAt:  string;
}

interface VixDataPoint {
  date:  string;
  value: number;
}
interface FredVixDetails {
  current:     number;
  avg7d:       number;
  avg7dPrev:   number;
  min30d:      number;
  max30d:      number;
  dataPoints:  VixDataPoint[];
  fetchedAt:   string;
}

interface NotamDetail {
  id:        string;
  fir:       string;
  firName:   string;
  tier:      number;
  text:      string;
  effective: string | null;
  expiry:    string | null;
  isNew:     boolean;
}

// ---------------------------------------------------------------------------
// Volume label per KRI type
// ---------------------------------------------------------------------------
const VOLUME_LABELS: Record<string, string> = {
  notam_restrictions:      "active restrictions",
  acled_violence:          "events",
  reliefweb_severity:      "severity points",
  worldmonitor_cii:        "CII score",
  opensky_aviation_stress: "emergency squawks",
  meteoalarm_warnings:     "active alerts",
  weather_efi:             "EFI score",
  fred_vix:                "VIX (7d avg)",
};

function volumeLabel(key: string): string {
  return VOLUME_LABELS[key] ?? "articles";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div className="h-10 bg-gray-800 rounded opacity-30" />;
  }

  const max = Math.max(...data, 1);
  const width = 120;
  const height = 40;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;
  const areaD = `M 0,${height} L ${points.join(" L ")} L ${width},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkGrad)" />
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrendArrow({ trend, pct }: { trend: string; pct: number }) {
  if (trend === "rising") {
    return (
      <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7 7 7" />
        </svg>
        +{pct}%
      </span>
    );
  }
  if (trend === "falling") {
    return (
      <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7-7-7" />
        </svg>
        {pct}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-gray-500 text-xs font-medium">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14" />
      </svg>
      {pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 70 ? "text-red-400" :
    score >= 45 ? "text-yellow-400" :
    "text-green-400";

  const barColor =
    score >= 70 ? "bg-red-500" :
    score >= 45 ? "bg-yellow-500" :
    "bg-green-500";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${color}`}>{score}</span>
        <span className="text-xs text-gray-600">/100</span>
      </div>
      <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOTAM date formatting
// ---------------------------------------------------------------------------

function formatNotamDate(s: string | null): string {
  if (!s) return "";
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(EST|EDT|CST|CDT|MST|MDT|PST|PDT)?/i);
  if (!m) return s;
  const [, y, mo, d] = m;
  const date = new Date(+y, +mo - 1, +d);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// NOTAM detail modal
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<number, { label: string; color: string }> = {
  3: { label: "FIR Closed / Conflict", color: "text-red-400 bg-red-500/10 border-red-500/30" },
  1: { label: "Caution / Restricted",  color: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
};

function NotamModal({ details, onClose }: { details: NotamDetail[]; onClose: () => void }) {
  const newCount = details.filter((d) => d.isNew).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Airspace Restrictions · Global</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {details.length} active &nbsp;·&nbsp;
              {newCount > 0
                ? <span className="text-orange-400">{newCount} new since last scan</span>
                : <span>no new since last scan</span>
              }
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
          {details.map((d) => {
            const tier = TIER_LABEL[d.tier] ?? TIER_LABEL[1];
            return (
              <div
                key={d.id}
                className={`rounded-lg border p-3 ${d.isNew ? "border-orange-500/40 bg-orange-500/5" : "border-gray-800 bg-gray-900/50"}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${tier.color}`}>
                      {tier.label}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">{d.firName}</span>
                    {d.isNew && (
                      <span className="text-xs text-orange-400 font-medium">NEW</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 shrink-0 text-right">
                    {d.effective && <span>{formatNotamDate(d.effective)}</span>}
                    {d.effective && d.expiry && <span className="mx-1">→</span>}
                    {d.expiry && <span>{formatNotamDate(d.expiry)}</span>}
                  </span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{d.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACLED detail modal
// ---------------------------------------------------------------------------

function AcledModal({ details, onClose }: { details: AcledDetails; onClose: () => void }) {
  const fmt = (n: number) => n.toLocaleString();
  const weekLabel = details.weekDate
    ? new Date(details.weekDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Violence Events · EU (ACLED)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Week of {weekLabel}&nbsp;·&nbsp;
              <span className="text-white">{fmt(details.totalEvents)}</span> events&nbsp;·&nbsp;
              <span className="text-red-400">{fmt(details.totalFatalities)}</span> fatalities
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Event types */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">By Event Type</h4>
            <div className="space-y-1.5">
              {details.byEventType.map((t) => {
                const pct = details.totalEvents > 0 ? (t.events / details.totalEvents) * 100 : 0;
                return (
                  <div key={t.eventType}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-300">{t.eventType}</span>
                      <span className="text-gray-500">
                        {fmt(t.events)} events&nbsp;·&nbsp;
                        <span className="text-red-400/80">{fmt(t.fatalities)} fatalities</span>
                      </span>
                    </div>
                    <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top countries */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Top Countries</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-600 border-b border-gray-800">
                  <th className="text-left pb-1.5 font-medium">Country</th>
                  <th className="text-right pb-1.5 font-medium">Events</th>
                  <th className="text-right pb-1.5 font-medium text-red-400/60">Fatalities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900">
                {details.byCountry.map((c) => (
                  <tr key={c.country} className="hover:bg-gray-900/50">
                    <td className="py-1.5 text-gray-300">{c.country}</td>
                    <td className="py-1.5 text-right text-gray-400">{fmt(c.events)}</td>
                    <td className="py-1.5 text-right text-red-400/70">{fmt(c.fatalities)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReliefWeb detail modal
// ---------------------------------------------------------------------------

function severityColor(s: number): { dot: string; badge: string } {
  if (s >= 10) return { dot: "bg-red-500",    badge: "text-red-400 bg-red-500/10 border-red-500/30" };
  if (s >= 8)  return { dot: "bg-orange-500", badge: "text-orange-400 bg-orange-500/10 border-orange-500/30" };
  if (s >= 5)  return { dot: "bg-yellow-400", badge: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" };
  return       { dot: "bg-green-500",  badge: "text-green-400 bg-green-500/10 border-green-500/30" };
}

function ReliefWebModal({ details, onClose }: { details: ReliefWebDetails; onClose: () => void }) {
  const fetchDate = details.fetchedAt
    ? new Date(details.fetchedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Humanitarian Disasters · Last 7 days (ReliefWeb)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {details.disasters.length} active · sorted by severity · {fetchDate}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1.5">
          {details.disasters.map((d) => {
            const { dot, badge } = severityColor(d.severity);
            return (
              <div key={d.id} className="rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-2 flex items-start gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-gray-200 font-medium leading-snug">{d.name}</span>
                    <span className="text-xs text-gray-600 shrink-0">
                      {new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {d.types.map((t) => (
                      <span key={t} className={`text-xs px-1.5 py-0.5 rounded border font-medium ${badge}`}>{t}</span>
                    ))}
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${d.status === "alert" ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-gray-500 border-gray-700"}`}>
                      {d.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {details.disasters.length === 0 && (
            <p className="text-xs text-gray-500 py-4 text-center">No new disasters in the last 7 days</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MeteoAlarm detail modal
// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<string, { label: string; color: string; dot: string }> = {
  extreme: { label: "Red",    color: "text-red-400 bg-red-500/10 border-red-500/30",          dot: "bg-red-500"    },
  severe:  { label: "Orange", color: "text-orange-400 bg-orange-500/10 border-orange-500/30", dot: "bg-orange-500" },
};

function MeteoAlarmModal({ details, onClose }: { details: MeteoAlarmDetails; onClose: () => void }) {
  const warnings = details.warnings.filter((w) => w.severity === "extreme" || w.severity === "severe");
  const redCount    = warnings.filter((w) => w.severity === "extreme").length;
  const orangeCount = warnings.filter((w) => w.severity === "severe").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Weather Warnings · EU (MeteoAlarm)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="text-red-400 font-medium">{redCount} red</span>
              &nbsp;·&nbsp;<span className="text-orange-400">{orangeCount} orange</span>
              &nbsp;·&nbsp;{warnings.length} total active
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1.5">
          {warnings.map((w, i) => {
            const s = SEVERITY_STYLE[w.severity] ?? SEVERITY_STYLE.severe;
            return (
              <div key={i} className={`rounded-lg border px-3 py-2 flex items-start gap-3 ${s.color}`}>
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide">{w.country}</span>
                    <span className="text-xs font-medium capitalize">{w.event}</span>
                    <span className="text-xs text-gray-500 truncate">{w.area}</span>
                  </div>
                </div>
                <span className="text-xs text-gray-600 shrink-0">
                  {w.sent ? new Date(w.sent).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
                </span>
              </div>
            );
          })}
          {details.warnings.length === 0 && (
            <p className="text-xs text-gray-500 py-4 text-center">No active red or orange warnings in EU</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EFI detail modal
// ---------------------------------------------------------------------------

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-6 w-16 bg-gray-800 rounded opacity-30" />;
  const max = Math.max(...data, 0.01);
  const w = 64, h = 24;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" L ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <path d={`M ${pts}`} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function zColor(z: number) {
  const abs = Math.abs(z);
  return abs >= 3 ? "text-red-400" : abs >= 2 ? "text-orange-400" : abs >= 1 ? "text-yellow-400" : "text-gray-500";
}

function EfiRow({
  label, unit,
  peak, avg, z,
}: {
  label: string; unit: string;
  peak: number | null; avg: number; z: number;
}) {
  const sigmaColor = zColor(z);
  const barPct = Math.min(100, Math.round((Math.abs(z) / 3) * 100));
  const barColor = Math.abs(z) >= 3 ? "bg-red-500" : Math.abs(z) >= 2 ? "bg-orange-500" : Math.abs(z) >= 1 ? "bg-yellow-400" : "bg-green-500";
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-gray-500 w-24 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-gray-300">
            {peak !== null ? `${peak}${unit}` : "—"}
            <span className="text-gray-600 ml-1">(avg {avg}{unit})</span>
          </span>
          <span className={`font-semibold ${sigmaColor}`}>
            {z > 0 ? "+" : ""}{z}σ
          </span>
        </div>
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function EfiModal({ details, onClose }: { details: EfiDetails; onClose: () => void }) {
  const fetchDate = details.fetchedAt
    ? new Date(details.fetchedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Extreme Weather · Key Cities</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Peak forecast vs 30-day baseline · {fetchDate}
              {details.maxEfi > 0.1 && (
                <>&nbsp;·&nbsp;<span className="text-orange-400">highest: {details.maxEfiCity}</span></>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {details.cities.map((city) => {
            const efiPct = Math.round(city.efi * 100);
            const efiCol = efiPct >= 70 ? "text-red-400" : efiPct >= 40 ? "text-orange-400" : efiPct >= 20 ? "text-yellow-400" : "text-green-400";
            return (
              <div key={city.code} className="bg-gray-900/60 rounded-xl p-3 border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white text-sm font-semibold">{city.name}</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold ${efiCol}`}>{efiPct}/100</span>
                    <MiniSparkline data={city.forecast} />
                  </div>
                </div>
                <div className="space-y-2">
                  <EfiRow label="Temperature"   unit="°C"   peak={city.tempMax}   avg={city.tempMean}   z={city.tempZ}   />
                  <EfiRow label="Precipitation"  unit="mm"   peak={city.precipMax} avg={city.precipMean} z={city.precipZ} />
                  <EfiRow label="Wind speed"     unit=" km/h" peak={city.windMax}  avg={city.windMean}   z={city.windZ}   />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-gray-600 pb-1 text-center">
            σ = standard deviations from 30-day baseline · bars show deviation up to 3σ
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FRED VIX detail modal
// ---------------------------------------------------------------------------

function vixLevelLabel(v: number): { label: string; color: string } {
  if (v < 15) return { label: "Low",      color: "text-green-400" };
  if (v < 20) return { label: "Normal",   color: "text-gray-400"  };
  if (v < 30) return { label: "Elevated", color: "text-yellow-400"};
  if (v < 40) return { label: "High",     color: "text-orange-400"};
  return             { label: "Extreme",  color: "text-red-400"   };
}

function FredVixModal({ details, onClose }: { details: FredVixDetails; onClose: () => void }) {
  const fetchDate = details.fetchedAt
    ? new Date(details.fetchedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  const { label, color } = vixLevelLabel(details.current);

  // Mini sparkline for the 30-day VIX chart
  const values = details.dataPoints.map((p) => p.value);
  const maxVal = Math.max(...values, 1);
  const minVal = Math.min(...values);
  const range  = maxVal - minVal || 1;
  const W = 480, H = 60;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - minVal) / range) * H;
    return `${x},${y}`;
  }).join(" L ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Market Volatility · VIX (CBOE via FRED)</h3>
            <p className="text-xs text-gray-500 mt-0.5">Last 30 trading days · {fetchDate}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Current value callout */}
          <div className="flex items-center gap-6">
            <div>
              <div className={`text-4xl font-bold ${color}`}>{details.current}</div>
              <div className={`text-xs font-semibold mt-0.5 ${color}`}>{label}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <span className="text-gray-500">7-day avg</span>
              <span className="text-gray-300 text-right">{details.avg7d}</span>
              <span className="text-gray-500">Prior 7-day avg</span>
              <span className="text-gray-300 text-right">{details.avg7dPrev}</span>
              <span className="text-gray-500">30-day min</span>
              <span className="text-gray-300 text-right">{details.min30d}</span>
              <span className="text-gray-500">30-day max</span>
              <span className="text-gray-300 text-right">{details.max30d}</span>
            </div>
          </div>

          {/* 30-day chart */}
          <div className="bg-gray-900/60 rounded-xl p-3 border border-gray-800">
            <p className="text-xs text-gray-600 mb-2">30 trading days</p>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`M 0,${H} L ${pts} L ${W},${H} Z`} fill="url(#vixGrad)" />
              <path d={`M ${pts}`} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex justify-between text-xs text-gray-700 mt-1">
              <span>{details.dataPoints[0]?.date}</span>
              <span>{details.dataPoints[details.dataPoints.length - 1]?.date}</span>
            </div>
          </div>

          {/* Scale reference */}
          <div className="grid grid-cols-5 gap-1 text-xs text-center">
            {[
              { range: "< 15",  label: "Low",      color: "bg-green-500/20 text-green-400  border-green-500/30"  },
              { range: "15–20", label: "Normal",   color: "bg-gray-700/40  text-gray-400   border-gray-600/30"   },
              { range: "20–30", label: "Elevated", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"},
              { range: "30–40", label: "High",     color: "bg-orange-500/20 text-orange-400 border-orange-500/30"},
              { range: "> 40",  label: "Extreme",  color: "bg-red-500/20   text-red-400    border-red-500/30"    },
            ].map((s) => (
              <div key={s.label} className={`rounded border px-1 py-1.5 ${s.color}`}>
                <div className="font-medium">{s.label}</div>
                <div className="text-gray-600 mt-0.5">{s.range}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KRI card
// ---------------------------------------------------------------------------

function KriCard({ kri, onDetail }: { kri: KriMeasurement; onDetail?: () => void }) {
  const catColor = CATEGORY_COLORS[kri.category] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
  let sparklineData: number[] = [];
  try {
    sparklineData = JSON.parse(kri.sparkline);
  } catch {
    sparklineData = [];
  }

  let parsedDetails: unknown = null;
  try { if (kri.details) parsedDetails = JSON.parse(kri.details); } catch { /* ignore */ }
  const hasDetails =
    (Array.isArray(parsedDetails) && parsedDetails.length > 0) ||
    (parsedDetails !== null && typeof parsedDetails === "object" && (
      "byCountry"   in (parsedDetails as object) ||
      "disasters"   in (parsedDetails as object) ||
      "warnings"    in (parsedDetails as object) ||
      "cities"      in (parsedDetails as object) ||
      "dataPoints"  in (parsedDetails as object)
    ));

  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${hasDetails ? "cursor-pointer hover:border-gray-700 transition-colors" : ""}`}
      onClick={hasDetails ? onDetail : undefined}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${catColor}`}>
          {kri.category}
        </span>
        <div className="flex items-center gap-2">
          <TrendArrow trend={kri.trend} pct={kri.trendPct} />
          {hasDetails && (
            <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
      </div>

      <p className="text-white text-sm font-semibold mb-3 leading-snug">{kri.name}</p>

      <div className="flex items-end justify-between gap-2">
        <ScoreGauge score={Math.round(kri.score)} />
        <Sparkline data={sparklineData} />
      </div>

      <p className="text-xs text-gray-600 mt-2">
        {kri.volume7d.toLocaleString()} {volumeLabel(kri.key)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function KriPanel({ measurements }: { measurements: KriMeasurement[] }) {
  const [activeNotam,     setActiveNotam]     = useState<NotamDetail[]        | null>(null);
  const [activeAcled,     setActiveAcled]     = useState<AcledDetails          | null>(null);
  const [activeReliefWeb, setActiveReliefWeb] = useState<ReliefWebDetails      | null>(null);
  const [activeMeteo,     setActiveMeteo]     = useState<MeteoAlarmDetails     | null>(null);
  const [activeEfi,       setActiveEfi]       = useState<EfiDetails            | null>(null);
  const [activeFredVix,   setActiveFredVix]   = useState<FredVixDetails        | null>(null);

  if (measurements.length === 0) return null;

  function openDetails(kri: KriMeasurement) {
    if (!kri.details) return;
    try {
      const parsed = JSON.parse(kri.details);
      if (!parsed || typeof parsed !== "object") return;
      if (Array.isArray(parsed)) {
        setActiveNotam(parsed as NotamDetail[]);
      } else if ("byCountry" in parsed) {
        setActiveAcled(parsed as AcledDetails);
      } else if ("disasters" in parsed) {
        setActiveReliefWeb(parsed as ReliefWebDetails);
      } else if ("warnings" in parsed) {
        setActiveMeteo(parsed as MeteoAlarmDetails);
      } else if ("cities" in parsed) {
        setActiveEfi(parsed as EfiDetails);
      } else if ("dataPoints" in parsed) {
        setActiveFredVix(parsed as FredVixDetails);
      }
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="mb-8">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Key Risk Indicators — 7-day signal vs. 90-day baseline
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {measurements.map((kri) => (
            <KriCard
              key={kri.key}
              kri={kri}
              onDetail={() => openDetails(kri)}
            />
          ))}
        </div>
      </div>

      {activeNotam     && <NotamModal      details={activeNotam}     onClose={() => setActiveNotam(null)}     />}
      {activeAcled     && <AcledModal      details={activeAcled}     onClose={() => setActiveAcled(null)}     />}
      {activeReliefWeb && <ReliefWebModal  details={activeReliefWeb} onClose={() => setActiveReliefWeb(null)} />}
      {activeMeteo     && <MeteoAlarmModal details={activeMeteo}     onClose={() => setActiveMeteo(null)}     />}
      {activeEfi       && <EfiModal        details={activeEfi}       onClose={() => setActiveEfi(null)}       />}
      {activeFredVix   && <FredVixModal    details={activeFredVix}   onClose={() => setActiveFredVix(null)}   />}
    </>
  );
}
