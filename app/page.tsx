import { prisma } from "@/lib/prisma";
import RiskCard from "@/components/RiskCard";
import CategoryFilter from "@/components/CategoryFilter";
import KriPanel from "@/components/KriPanel";
import { Suspense } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ category?: string; scanRunId?: string }>;
}

async function Dashboard({ searchParams }: PageProps) {
  const params = await searchParams;
  const { category, scanRunId } = params;

  // Get the latest completed scan (or requested scan)
  let targetScanRunId = scanRunId;
  if (!targetScanRunId) {
    const latestScan = await prisma.scanRun.findFirst({
      where: { status: "completed" },
      orderBy: { startedAt: "desc" },
    });
    targetScanRunId = latestScan?.id ?? undefined;
  }

  const [topics, scanRun, recentScans, kriMeasurements] = await Promise.all([
    targetScanRunId
      ? prisma.riskTopic.findMany({
          where: {
            scanRunId: targetScanRunId,
            ...(category ? { category } : {}),
          },
          include: { _count: { select: { articles: true } } },
          orderBy: { impactScore: "desc" },
        })
      : Promise.resolve([]),
    targetScanRunId
      ? prisma.scanRun.findUnique({ where: { id: targetScanRunId } })
      : Promise.resolve(null),
    prisma.scanRun.findMany({
      where: { status: "completed" },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true, startedAt: true, topicsFound: true },
    }),
    targetScanRunId
      ? prisma.kriMeasurement.findMany({
          where: { scanRunId: targetScanRunId },
          orderBy: { score: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const highRisk = topics.filter((t) => t.impactScore >= 8).length;
  const mediumRisk = topics.filter((t) => t.impactScore >= 5 && t.impactScore < 8).length;
  const lowRisk = topics.filter((t) => t.impactScore < 5).length;

  return (
    <div>
      {/* Header row */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-1">Risk Dashboard</h2>
        <p className="text-sm text-gray-400">
          EU financial sector · External risk signals
        </p>
      </div>

      {/* KRI Panel */}
      <KriPanel measurements={kriMeasurements} />

      {/* Stats row */}
      {scanRun && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{topics.length}</div>
            <div className="text-xs text-gray-400 mt-0.5">Risk Topics</div>
          </div>
          <div className="bg-gray-900 border border-red-900/40 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">{highRisk}</div>
            <div className="text-xs text-gray-400 mt-0.5">High Impact</div>
          </div>
          <div className="bg-gray-900 border border-yellow-900/40 rounded-xl p-4">
            <div className="text-2xl font-bold text-yellow-400">{mediumRisk}</div>
            <div className="text-xs text-gray-400 mt-0.5">Medium Impact</div>
          </div>
          <div className="bg-gray-900 border border-green-900/40 rounded-xl p-4">
            <div className="text-2xl font-bold text-green-400">{lowRisk}</div>
            <div className="text-xs text-gray-400 mt-0.5">Low Impact</div>
          </div>
        </div>
      )}

      {/* Scan info + history */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          {scanRun ? (
            <p className="text-xs text-gray-500">
              Last scan:{" "}
              <span className="text-gray-400">
                {new Date(scanRun.startedAt).toLocaleString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
              {recentScans.length > 1 && (
                <span className="ml-3">
                  History:{" "}
                  {recentScans.slice(1).map((s) => (
                    <a
                      key={s.id}
                      href={`/?scanRunId=${s.id}`}
                      className="text-blue-500 hover:text-blue-400 mr-2"
                    >
                      {new Date(s.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      ({s.topicsFound})
                    </a>
                  ))}
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-gray-500">No scans yet. First scan runs automatically at 06:00 UTC.</p>
          )}
        </div>
        <Suspense>
          <CategoryFilter current={category ?? ""} />
        </Suspense>
      </div>

      {/* Risk cards */}
      {topics.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          {scanRun
            ? "No risk topics found for this filter."
            : "Awaiting first scheduled scan."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {topics.map((topic) => (
            <RiskCard
              key={topic.id}
              id={topic.id}
              title={topic.title}
              summary={topic.summary}
              category={topic.category}
              impactScore={topic.impactScore}
              impactReason={topic.impactReason}
              articleCount={topic._count.articles}
              createdAt={topic.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<div className="text-gray-500 text-sm">Loading...</div>}>
      <Dashboard {...props} />
    </Suspense>
  );
}
