export interface RawArticle {
  title: string;
  description: string | null;
  content: string | null;
  source: string;
  url: string;
  publishedAt: string;
}

// EU financial risk search queries — broad enough for NewsAPI free tier
const EU_QUERIES = [
  "European Central Bank bank",
  "EU financial regulation",
  "European bank risk",
  "cyber attack financial Europe",
  "EU economy crisis",
];

async function fetchQuery(
  query: string,
  apiKey: string,
  from: string
): Promise<RawArticle[]> {
  const params = new URLSearchParams({
    q: query,
    from,
    sortBy: "relevancy",
    language: "en",
    pageSize: "10",
    apiKey,
  });

  const res = await fetch(
    `https://newsapi.org/v2/everything?${params.toString()}`
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NewsAPI error (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.status !== "ok") {
    throw new Error(`NewsAPI returned status: ${data.status} — ${data.message}`);
  }

  return (data.articles ?? [])
    .filter(
      (a: { title?: string; url?: string }) =>
        a.title && a.url && !a.title.includes("[Removed]")
    )
    .map(
      (a: {
        title: string;
        description?: string;
        content?: string;
        source?: { name?: string };
        url: string;
        publishedAt: string;
      }) => ({
        title: a.title,
        description: a.description ?? null,
        content: a.content ?? null,
        source: a.source?.name ?? "Unknown",
        url: a.url,
        publishedAt: a.publishedAt,
      })
    );
}

export async function fetchEUFinancialNews(): Promise<RawArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) throw new Error("NEWS_API_KEY is not set");

  // Fetch articles from the last 7 days (wider window for free tier)
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Run all queries in parallel, cap to 5 queries to stay within free plan limits
  const selectedQueries = EU_QUERIES.slice(0, 5);
  const results = await Promise.allSettled(
    selectedQueries.map((q) => fetchQuery(q, apiKey, from))
  );

  const allArticles: RawArticle[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allArticles.push(...result.value);
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allArticles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Limit to 40 most relevant articles to keep Claude prompt size manageable
  return unique.slice(0, 40);
}
