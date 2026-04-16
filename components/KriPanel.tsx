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

interface MeteoWarning {
  country:  string;
  area:     string;
  event:    string;
  severity: "extreme" | "severe" | "moderate";
  sent:     string;
}
interface MeteoAlarmDetails {
  totalWarnings: number;
  redCount:      number;
  orangeCount:   number;
  yellowCount:   number;
  warnings:      MeteoWarning[];
}

interface EfiCityData {
  code:      string;
  name:      string;
  efi:       number;
  efiTemp:   number;
  efiPrecip: number;
  efiWind:   number;
  forecast:  number[];
}
interface EfiDetails {
  cities:     EfiCityData[];
  maxEfi:     number;
  maxEfiCity: string;
  fetchedAt:  string;
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
  reliefweb_crises:        "new crises",
  reliefweb_severity:      "severity points",
  worldmonitor_cii:        "CII score",
  opensky_aviation_stress: "emergency squawks",
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
// MeteoAlarm detail modal
// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<string, { label: string; color: string; dot: string }> = {
  extreme: { label: "Red / Extreme",    color: "text-red-400 bg-red-500/10 border-red-500/30",      dot: "bg-red-500"    },
  severe:  { label: "Orange / Severe",  color: "text-orange-400 bg-orange-500/10 border-orange-500/30", dot: "bg-orange-500" },
  moderate:{ label: "Yellow / Moderate",color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30", dot: "bg-yellow-400" },
};

function MeteoAlarmModal({ details, onClose }: { details: MeteoAlarmDetails; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Weather Warnings · EU (MeteoAlarm)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="text-red-400 font-medium">{details.redCount} red</span>
              &nbsp;·&nbsp;<span className="text-orange-400">{details.orangeCount} orange</span>
              &nbsp;·&nbsp;<span className="text-yellow-400">{details.yellowCount} yellow</span>
              &nbsp;·&nbsp;{details.totalWarnings} total active
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1.5">
          {details.warnings.map((w, i) => {
            const s = SEVERITY_STYLE[w.severity] ?? SEVERITY_STYLE.moderate;
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
            <p className="text-xs text-gray-500 py-4 text-center">No active moderate–extreme warnings in EU</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EFI detail modal
// ---------------------------------------------------------------------------

function EfiBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden w-full">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function efiColor(v: number): string {
  return v >= 0.7 ? "bg-red-500" : v >= 0.4 ? "bg-orange-500" : v >= 0.2 ? "bg-yellow-400" : "bg-green-500";
}

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

function EfiModal({ details, onClose }: { details: EfiDetails; onClose: () => void }) {
  const fetchDate = details.fetchedAt
    ? new Date(details.fetchedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-semibold text-sm">Extreme Weather · Key Cities (EFI)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              7-day forecast via ECMWF IFS (Open-Meteo) · {fetchDate}
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
          {details.cities.map((city) => (
            <div key={city.code} className="bg-gray-900/60 rounded-xl p-3 border border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-sm font-semibold">{city.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${city.efi >= 0.7 ? "text-red-400" : city.efi >= 0.4 ? "text-orange-400" : city.efi >= 0.2 ? "text-yellow-400" : "text-green-400"}`}>
                    {Math.round(city.efi * 100)}/100
                  </span>
                  <MiniSparkline data={city.forecast} />
                </div>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Temperature", value: city.efiTemp },
                  { label: "Precipitation", value: city.efiPrecip },
                  { label: "Wind",          value: city.efiWind },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0">{label}</span>
                    <EfiBar value={value} color={efiColor(value)} />
                    <span className="text-xs text-gray-500 w-8 text-right">{Math.round(value * 100)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
      "byCountry" in (parsedDetails as object) ||
      "warnings"  in (parsedDetails as object) ||
      "cities"    in (parsedDetails as object)
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
  const [activeNotam,  setActiveNotam]  = useState<NotamDetail[]     | null>(null);
  const [activeAcled,  setActiveAcled]  = useState<AcledDetails      | null>(null);
  const [activeMeteo,  setActiveMeteo]  = useState<MeteoAlarmDetails | null>(null);
  const [activeEfi,    setActiveEfi]    = useState<EfiDetails        | null>(null);

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
      } else if ("warnings" in parsed) {
        setActiveMeteo(parsed as MeteoAlarmDetails);
      } else if ("cities" in parsed) {
        setActiveEfi(parsed as EfiDetails);
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

      {activeNotam && <NotamModal      details={activeNotam} onClose={() => setActiveNotam(null)} />}
      {activeAcled && <AcledModal      details={activeAcled} onClose={() => setActiveAcled(null)} />}
      {activeMeteo && <MeteoAlarmModal details={activeMeteo} onClose={() => setActiveMeteo(null)} />}
      {activeEfi   && <EfiModal        details={activeEfi}   onClose={() => setActiveEfi(null)}   />}
    </>
  );
}
