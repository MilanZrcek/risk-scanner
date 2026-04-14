export interface KriDefinition {
  key: string;
  name: string;
  category: string;
  query: string;
}

export interface KriResult {
  key: string;
  name: string;
  category: string;
  volume7d: number;
  volume7dPrev: number;
  avgDaily: number;
  score: number;       // 0–100
  trend: "rising" | "stable" | "falling";
  trendPct: number;    // % change
  sparkline: number[]; // last 30 daily volumes
}

// 5 KRI definitions for EU financial sector
export const KRI_DEFINITIONS: KriDefinition[] = [
  {
    key: "regulatory_pressure",
    name: "Regulatory Pressure",
    category: "Regulatory",
    query: '"European Central Bank" OR "EBA" OR "ESMA" OR "EIOPA" regulation bank financial',
  },
  {
    key: "cyber_threat",
    name: "Cyber Threat Level",
    category: "Cybersecurity",
    query: 'cyberattack OR ransomware OR "data breach" financial bank Europe',
  },
  {
    key: "market_stress",
    name: "Market Stress",
    category: "Market",
    query: '"banking crisis" OR "financial crisis" OR "bank failure" OR "credit risk" Europe',
  },
  {
    key: "geopolitical_risk",
    name: "Geopolitical Risk",
    category: "Geopolitical",
    query: 'sanctions OR "trade war" OR conflict "European economy" OR "EU economy" OR "euro"',
  },
  {
    key: "fraud_aml",
    name: "Fraud & AML Activity",
    category: "Operational",
    query: 'fraud OR "money laundering" OR AML OR "financial crime" European bank',
  },
];

interface GdeltTimelinePoint {
  date: string;  // "20260101120000"
  value: number;
}

async function fetchGdeltTimeline(query: string): Promise<GdeltTimelinePoint[]> {
  const params = new URLSearchParams({
    query,
    mode: "timelinevol",
    timespan: "3m",
    format: "json",
  });

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`GDELT API error: ${res.status}`);
  }

  const data = await res.json();

  // GDELT timeline response structure:
  // { timeline: [{ series: [{ data: [{date, value}] }] }] }
  const points: GdeltTimelinePoint[] =
    data?.timeline?.[0]?.series?.[0]?.data ?? [];

  return points;
}

function computeKriMetrics(
  def: KriDefinition,
  points: GdeltTimelinePoint[]
): KriResult {
  if (points.length === 0) {
    return {
      ...def,
      volume7d: 0,
      volume7dPrev: 0,
      avgDaily: 0,
      score: 0,
      trend: "stable",
      trendPct: 0,
      sparkline: [],
    };
  }

  // Sort ascending by date
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((p) => p.value);

  // Last 30 days for sparkline
  const sparkline = values.slice(-30);

  // Last 7 days volume
  const last7 = values.slice(-7);
  const prev7 = values.slice(-14, -7);

  const volume7d = Math.round(last7.reduce((s, v) => s + v, 0));
  const volume7dPrev = Math.round(prev7.reduce((s, v) => s + v, 0));

  // 90-day daily average
  const avgDaily = values.reduce((s, v) => s + v, 0) / Math.max(values.length, 1);

  // Score: how does last 7d daily average compare to 90d baseline?
  // 50 = at baseline, 100 = 2× above baseline, 0 = no activity
  const last7Avg = volume7d / 7;
  const score = avgDaily > 0
    ? Math.min(100, Math.round((last7Avg / avgDaily) * 50))
    : 0;

  // Trend
  const trendPct = volume7dPrev > 0
    ? Math.round(((volume7d - volume7dPrev) / volume7dPrev) * 100)
    : 0;

  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  return {
    ...def,
    volume7d,
    volume7dPrev,
    avgDaily: Math.round(avgDaily * 10) / 10,
    score,
    trend,
    trendPct,
    sparkline,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function measureKRIs(): Promise<KriResult[]> {
  // GDELT rate limit: 1 request per 5 seconds — run sequentially
  const results: KriResult[] = [];

  for (let i = 0; i < KRI_DEFINITIONS.length; i++) {
    const def = KRI_DEFINITIONS[i];
    try {
      const points = await fetchGdeltTimeline(def.query);
      results.push(computeKriMetrics(def, points));
    } catch (e) {
      console.error(`KRI "${def.name}" failed:`, e);
      results.push({
        ...def,
        volume7d: 0,
        volume7dPrev: 0,
        avgDaily: 0,
        score: 0,
        trend: "stable" as const,
        trendPct: 0,
        sparkline: [],
      });
    }
    // Wait 10 seconds between requests (GDELT limit: 1 req/5s, extra buffer)
    if (i < KRI_DEFINITIONS.length - 1) await sleep(10000);
  }

  return results;
}
