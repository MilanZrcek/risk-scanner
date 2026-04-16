import { prisma } from "./prisma";
import { fetchEUFinancialNews } from "./newsapi";
import { analyzeArticles } from "./analyzer";
import { measureKRIs } from "./gdelt";
import { measureAcledKri } from "./acled";
import { measureReliefWebKris } from "./reliefweb";
import { measureWorldMonitorKri } from "./worldmonitor";
import { measureNotamKri } from "./notam";

export async function runScan(): Promise<{ scanRunId: string; topicsFound: number }> {
  // Create scan run record
  const scanRun = await prisma.scanRun.create({
    data: { status: "pending" },
  });

  try {
    // 1. Fetch news
    const articles = await fetchEUFinancialNews();

    // 2. Measure KRIs via internal DB + ACLED
    const [kriResults, acledKri, reliefwebKris, wmKri, notamKri] = await Promise.allSettled([
      process.env.SKIP_GDELT === "true"   ? Promise.resolve([])      : measureKRIs(),
      process.env.ACLED_EMAIL             ? measureAcledKri()         : Promise.resolve(null),
      process.env.RELIEFWEB_APPNAME       ? measureReliefWebKris()    : Promise.resolve([]),
      process.env.WORLDMONITOR_API_KEY    ? measureWorldMonitorKri()  : Promise.resolve(null),
      process.env.RAPIDAPI_KEY            ? measureNotamKri()         : Promise.resolve(null),
    ]);

    const allKriResults = [
      ...(kriResults.status    === "fulfilled" ? kriResults.value                                : []),
      ...(acledKri.status      === "fulfilled" && acledKri.value    ? [acledKri.value]          : []),
      ...(reliefwebKris.status === "fulfilled" ? reliefwebKris.value                             : []),
      ...(wmKri.status         === "fulfilled" && wmKri.value       ? [wmKri.value]             : []),
      ...(notamKri.status      === "fulfilled" && notamKri.value    ? [notamKri.value]          : []),
    ];

    if (acledKri.status      === "rejected") console.warn("ACLED KRI failed:",         acledKri.reason);
    if (reliefwebKris.status === "rejected") console.warn("ReliefWeb KRI failed:",     reliefwebKris.reason);
    if (wmKri.status         === "rejected") console.warn("World Monitor KRI failed:", wmKri.reason);
    if (notamKri.status      === "rejected") console.warn("NOTAM KRI failed:",         notamKri.reason);

    // 2. Analyze articles with Claude
    const topics = await analyzeArticles(articles);

    // 3. Persist topics + articles + KRI measurements
    await prisma.$transaction([
      ...topics.map((topic) =>
        prisma.riskTopic.create({
          data: {
            scanRunId: scanRun.id,
            title: topic.title,
            summary: topic.summary,
            category: topic.category,
            impactScore: topic.impactScore,
            impactReason: topic.impactReason,
            articles: {
              create: topic.articles.map((a) => ({
                title: a.title,
                source: a.source,
                url: a.url,
                publishedAt: new Date(a.publishedAt),
                summary: a.summary,
              })),
            },
          },
        })
      ),
      ...allKriResults.map((kri) =>
        prisma.kriMeasurement.create({
          data: {
            scanRunId: scanRun.id,
            key: kri.key,
            name: kri.name,
            category: kri.category,
            volume7d: kri.volume7d,
            volume7dPrev: kri.volume7dPrev,
            avgDaily: kri.avgDaily,
            score: kri.score,
            trend: kri.trend,
            trendPct: kri.trendPct,
            sparkline: JSON.stringify(kri.sparkline),
            details:   kri.details !== undefined ? JSON.stringify(kri.details) : null,
          },
        })
      ),
    ]);

    // 4. Mark scan as completed
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        topicsFound: topics.length,
        articlesRead: articles.length,
      },
    });

    return { scanRunId: scanRun.id, topicsFound: topics.length };
  } catch (error) {
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
