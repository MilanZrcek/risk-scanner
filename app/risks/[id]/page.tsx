import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CATEGORY_COLORS } from "@/components/CategoryFilter";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function ImpactBar({ score }: { score: number }) {
  const color = score >= 8 ? "bg-red-500" : score >= 5 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className="text-sm font-bold text-white w-8 text-right">{score}/10</span>
    </div>
  );
}

export default async function RiskDetailPage({ params }: PageProps) {
  const { id } = await params;

  const topic = await prisma.riskTopic.findUnique({
    where: { id },
    include: {
      articles: { orderBy: { publishedAt: "desc" } },
      scanRun: true,
    },
  });

  if (!topic) notFound();

  const catColor = CATEGORY_COLORS[topic.category] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
  const impactLabel = topic.impactScore >= 8 ? "High" : topic.impactScore >= 5 ? "Medium" : "Low";
  const impactColor = topic.impactScore >= 8 ? "text-red-400" : topic.impactScore >= 5 ? "text-yellow-400" : "text-green-400";

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <Link href="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-6 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      {/* Topic header */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${catColor}`}>
            {topic.category}
          </span>
          <span className={`text-xs font-semibold ${impactColor}`}>
            {impactLabel} Impact
          </span>
        </div>

        <h1 className="text-xl font-bold text-white mb-4">{topic.title}</h1>

        <p className="text-gray-300 text-sm leading-relaxed mb-6">{topic.summary}</p>

        {/* Impact score */}
        <div className="border-t border-gray-800 pt-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Impact Assessment
          </h3>
          <ImpactBar score={topic.impactScore} />
          <p className="text-gray-400 text-sm leading-relaxed mt-3">{topic.impactReason}</p>
        </div>

        <div className="flex items-center gap-4 mt-5 pt-5 border-t border-gray-800 text-xs text-gray-600">
          <span>Identified: {new Date(topic.createdAt).toLocaleString("en-GB", {
            day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
          })}</span>
          <span>Scan: {new Date(topic.scanRun.startedAt).toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric"
          })}</span>
        </div>
      </div>

      {/* Supporting articles */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Supporting Articles ({topic.articles.length})
        </h2>

        {topic.articles.length === 0 ? (
          <p className="text-gray-600 text-sm">No articles available for this topic.</p>
        ) : (
          <div className="space-y-3">
            {topic.articles.map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium leading-snug group-hover:text-blue-300 transition-colors mb-1.5">
                      {article.title}
                    </p>
                    {article.summary && (
                      <p className="text-gray-400 text-xs leading-relaxed line-clamp-2">
                        {article.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                      <span className="font-medium text-gray-500">{article.source}</span>
                      <span>
                        {new Date(article.publishedAt).toLocaleDateString("en-GB", {
                          day: "numeric", month: "short", year: "numeric"
                        })}
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 flex-shrink-0 mt-0.5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
