"use client";

import { useRouter, useSearchParams } from "next/navigation";

const CATEGORIES = [
  "All",
  "Regulatory",
  "Cybersecurity",
  "Market",
  "Geopolitical",
  "Technology",
  "Operational",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Regulatory: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Cybersecurity: "bg-red-500/20 text-red-300 border-red-500/30",
  Market: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  Geopolitical: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Technology: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Operational: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

export { CATEGORY_COLORS };

export default function CategoryFilter({ current }: { current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSelect(cat: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (cat === "All") {
      params.delete("category");
    } else {
      params.set("category", cat);
    }
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((cat) => {
        const isActive = cat === "All" ? !current : current === cat;
        return (
          <button
            key={cat}
            onClick={() => handleSelect(cat)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              isActive
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
            }`}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
