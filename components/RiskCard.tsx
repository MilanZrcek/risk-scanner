import Link from "next/link";
import { CATEGORY_COLORS } from "./CategoryFilter";

interface RiskCardProps {
  id: string;
  title: string;
  summary: string;
  category: string;
  impactScore: number;
  impactReason: string;
  articleCount: number;
  createdAt: Date | string;
}

function ImpactBadge({ score }: { score: number }) {
  const color =
    score >= 8
      ? "bg-red-500/20 text-red-300 border-red-500/40"
      : score >= 5
      ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
      : "bg-green-500/20 text-green-300 border-green-500/40";

  const label = score >= 8 ? "High" : score >= 5 ? "Medium" : "Low";

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${color}`}>
      <span className={`w-2 h-2 rounded-full ${
        score >= 8 ? "bg-red-400" : score >= 5 ? "bg-yellow-400" : "bg-green-400"
      }`} />
      {label} · {score}/10
    </div>
  );
}

export default function RiskCard({
  id,
  title,
  summary,
  category,
  impactScore,
  impactReason,
  articleCount,
  createdAt,
}: RiskCardProps) {
  const catColor = CATEGORY_COLORS[category] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";

  return (
    <Link href={`/risks/${id}`}>
      <div className="group bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-all hover:bg-gray-800/50 cursor-pointer">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${catColor}`}>
              {category}
            </span>
            <ImpactBadge score={impactScore} />
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        <h3 className="text-white font-semibold text-sm mb-2 leading-snug">
          {title}
        </h3>

        <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-2">
          {summary}
        </p>

        <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 mb-3">
          <span className="text-gray-600 font-medium">Impact: </span>{impactReason}
        </p>

        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>{articleCount} article{articleCount !== 1 ? "s" : ""}</span>
          <span>{new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
      </div>
    </Link>
  );
}
