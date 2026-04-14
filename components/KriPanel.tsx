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
}

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

function KriCard({ kri }: { kri: KriMeasurement }) {
  const catColor = CATEGORY_COLORS[kri.category] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
  let sparklineData: number[] = [];
  try {
    sparklineData = JSON.parse(kri.sparkline);
  } catch {
    sparklineData = [];
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${catColor}`}>
          {kri.category}
        </span>
        <TrendArrow trend={kri.trend} pct={kri.trendPct} />
      </div>

      <p className="text-white text-sm font-semibold mb-3 leading-snug">{kri.name}</p>

      <div className="flex items-end justify-between gap-2">
        <ScoreGauge score={Math.round(kri.score)} />
        <Sparkline data={sparklineData} />
      </div>

      <p className="text-xs text-gray-600 mt-2">
        {kri.volume7d.toLocaleString()} articles · last 7 days
      </p>
    </div>
  );
}

export default function KriPanel({ measurements }: { measurements: KriMeasurement[] }) {
  if (measurements.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
        Key Risk Indicators — 7-day signal vs. 90-day baseline
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {measurements.map((kri) => (
          <KriCard key={kri.key} kri={kri} />
        ))}
      </div>
    </div>
  );
}
