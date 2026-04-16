import { prisma } from "./prisma";

export interface KriDefinition {
  key: string;
  name: string;
  category: string;
}

export interface KriResult {
  key: string;
  name: string;
  category: string;
  volume7d: number;      // topic count in latest scan for this category
  volume7dPrev: number;  // topic count in previous scan
  avgDaily: number;      // average topic count per scan (historical)
  score: number;         // 0–100 normalized impact score
  trend: "rising" | "stable" | "falling";
  trendPct: number;
  sparkline: number[];   // avg impact score per scan (last 30)
  details?: unknown;     // KRI-specific structured detail data (serialised to DB as JSON)
}

export const KRI_DEFINITIONS: KriDefinition[] = [
  { key: "regulatory_pressure", name: "Regulatory Pressure",  category: "Regulatory"    },
  { key: "cyber_threat",        name: "Cyber Threat Level",   category: "Cybersecurity" },
  { key: "market_stress",       name: "Market Stress",        category: "Market"        },
  { key: "geopolitical_risk",   name: "Geopolitical Risk",    category: "Geopolitical"  },
  { key: "fraud_aml",           name: "Fraud & AML Activity", category: "Operational"   },
];

async function computeKriForCategory(def: KriDefinition): Promise<KriResult> {
  // Fetch last 30 completed scans with topics in this category
  const scans = await prisma.scanRun.findMany({
    where: { status: "completed" },
    orderBy: { startedAt: "desc" },
    take: 30,
    select: {
      topics: {
        where: { category: def.category },
        select: { impactScore: true },
      },
    },
  });

  if (scans.length === 0) {
    return { ...def, volume7d: 0, volume7dPrev: 0, avgDaily: 0, score: 0, trend: "stable", trendPct: 0, sparkline: [] };
  }

  // Per-scan: avg impact score (null if no topics in this category)
  const scanData = scans.map((s) => {
    if (s.topics.length === 0) return { count: 0, avgScore: 0 };
    const avg = s.topics.reduce((sum, t) => sum + t.impactScore, 0) / s.topics.length;
    return { count: s.topics.length, avgScore: avg };
  });

  const latest  = scanData[0];
  const prev    = scanData[1] ?? { count: 0, avgScore: 0 };

  // Score: normalize avg impact score to 0–100
  const score = Math.round(latest.avgScore * 10);

  // Trend: compare avg score of latest vs previous scan
  const trendPct =
    prev.avgScore > 0
      ? Math.round(((latest.avgScore - prev.avgScore) / prev.avgScore) * 100)
      : 0;
  const trend: KriResult["trend"] =
    trendPct >= 10 ? "rising" : trendPct <= -10 ? "falling" : "stable";

  // Sparkline: avg impact scores across last 30 scans (oldest → newest)
  const sparkline = scanData.map((d) => Math.round(d.avgScore * 10)).reverse();

  // Volume = topic count
  const avgDaily =
    scanData.reduce((sum, d) => sum + d.count, 0) / scanData.length;

  return {
    ...def,
    volume7d:     latest.count,
    volume7dPrev: prev.count,
    avgDaily:     Math.round(avgDaily * 10) / 10,
    score,
    trend,
    trendPct,
    sparkline,
  };
}

export async function measureKRIs(): Promise<KriResult[]> {
  const results = await Promise.all(
    KRI_DEFINITIONS.map((def) => computeKriForCategory(def))
  );
  return results;
}
