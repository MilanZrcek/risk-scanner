import Anthropic from "@anthropic-ai/sdk";
import type { RawArticle } from "./newsapi";

export interface AnalyzedTopic {
  title: string;
  summary: string;
  category:
    | "Regulatory"
    | "Cybersecurity"
    | "Market"
    | "Geopolitical"
    | "Technology"
    | "Operational";
  impactScore: number; // 1–10
  impactReason: string;
  articles: {
    title: string;
    source: string;
    url: string;
    publishedAt: string;
    summary: string;
  }[];
}

const SYSTEM_PROMPT = `You are a senior operational risk analyst specializing in the European financial sector.
Your task is to analyze news articles and identify distinct risk topics relevant to European financial institutions.

Risk categories:
- Regulatory: New EU regulations, compliance changes, supervisory actions (ECB, EBA, ESMA, EIOPA)
- Cybersecurity: Cyberattacks, data breaches, IT failures, DORA-related topics
- Market: Interest rates, credit risk, liquidity, asset price movements, inflation
- Geopolitical: Geopolitical tensions, sanctions, trade conflicts, political instability affecting EU
- Technology: AI, fintech, digital assets, cloud, infrastructure disruptions
- Operational: Fraud, AML, third-party risk, business continuity, ESG compliance

Impact scoring guidance (1–10):
- 9–10: Systemic or sector-wide risk, potential regulatory response required
- 7–8: Significant impact on multiple institutions, requires monitoring
- 5–6: Notable risk, relevant for proactive assessment
- 3–4: Moderate risk, limited to specific segments
- 1–2: Low risk or informational, early signal only`;

const USER_PROMPT_TEMPLATE = (
  articlesText: string
) => `Analyze the following ${articlesText.split("\n---\n").length} news articles about the European financial sector.

Group related articles into distinct risk topics. For each topic:
1. Identify which articles support it (by their index number)
2. Write a concise title (max 10 words)
3. Write a 2–3 sentence summary explaining the risk
4. Assign a category
5. Score the potential impact on European financial institutions (1–10)
6. Write 2–3 sentences explaining the impact reasoning

Return ONLY valid JSON in this exact format, no other text:
{
  "topics": [
    {
      "title": "string",
      "summary": "string",
      "category": "Regulatory|Cybersecurity|Market|Geopolitical|Technology|Operational",
      "impactScore": number,
      "impactReason": "string",
      "articleIndices": [number]
    }
  ]
}

Articles:
${articlesText}`;

function buildArticlesText(articles: RawArticle[]): string {
  return articles
    .map((a, i) => {
      const snippet = (a.description ?? a.content ?? "No description")
        .replace(/\[.*?\]/g, "")
        .slice(0, 300);
      return `[${i}] SOURCE: ${a.source} | DATE: ${a.publishedAt.slice(0, 10)}\nTITLE: ${a.title}\nSNIPPET: ${snippet}`;
    })
    .join("\n---\n");
}

export async function analyzeArticles(
  articles: RawArticle[]
): Promise<AnalyzedTopic[]> {
  if (articles.length === 0) return [];

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const articlesText = buildArticlesText(articles);

  // Use streaming + finalMessage to handle long analysis without timeout
  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 8000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    thinking: { type: "adaptive" } as any,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: USER_PROMPT_TEMPLATE(articlesText),
      },
    ],
  });

  const response = await stream.finalMessage();

  // Extract JSON from response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const text = textBlock.text.trim();

  // Parse JSON — Claude may wrap in markdown code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ??
    text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;

  let parsed: { topics: Array<{
    title: string;
    summary: string;
    category: string;
    impactScore: number;
    impactReason: string;
    articleIndices: number[];
  }> };

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${text.slice(0, 200)}`);
  }

  // Map topics with their supporting articles
  return parsed.topics.map((topic) => ({
    title: topic.title,
    summary: topic.summary,
    category: topic.category as AnalyzedTopic["category"],
    impactScore: Math.min(10, Math.max(1, Math.round(topic.impactScore))),
    impactReason: topic.impactReason,
    articles: (topic.articleIndices ?? [])
      .filter((i) => i >= 0 && i < articles.length)
      .map((i) => {
        const a = articles[i];
        return {
          title: a.title,
          source: a.source,
          url: a.url,
          publishedAt: a.publishedAt,
          summary: (a.description ?? a.content ?? "").slice(0, 500),
        };
      }),
  }));
}
