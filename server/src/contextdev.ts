import ContextDev from "context.dev";

declare global {
  var __faradayCtx: ContextDev | undefined;
}

export function ctx(): ContextDev {
  globalThis.__faradayCtx ??= new ContextDev({
    apiKey: process.env.CONTEXT_DEV_API_KEY,
    timeout: 60_000,
    maxRetries: 1,
  });
  return globalThis.__faradayCtx;
}

export type FoundDoc = {
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  snippet: string | null;
  kind: "news" | "web" | "monitor";
};

const clip = (s: string | null | undefined, n: number) =>
  s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null;

export async function searchNews(query: string, sinceMs: number, limit = 10): Promise<FoundDoc[]> {
  const res = await ctx().news.search({
    searchBy: { type: "natural_language", query },
    filterBy: { date: { from: sinceMs } },
    limit,
  });
  return (res.data ?? []).map((a) => ({
    url: a.url,
    title: a.title ?? null,
    publisher: a.source?.name ?? a.source?.domain ?? null,
    publishedAt: a.published_at ?? null,
    snippet: clip(a.description, 1200),
    kind: "news" as const,
  }));
}

export async function searchWeb(
  query: string,
  freshness: "last_24_hours" | "last_week" | "last_month" | "last_year",
  numResults = 6,
): Promise<FoundDoc[]> {
  const res = await ctx().web.search({
    query,
    numResults,
    freshness,
    highlightsOptions: { enabled: true, maxCharacters: 1500 },
  });
  return (res.results ?? []).map((r) => {
    const hl = r.highlights?.code === "SUCCESS" ? (r.highlights.highlights ?? []).join("\n") : null;
    let publisher: string | null = null;
    try {
      publisher = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {}
    return {
      url: r.url,
      title: r.title ?? null,
      publisher,
      publishedAt: null,
      snippet: clip(hl || r.description, 1500),
      kind: "web" as const,
    };
  });
}

// Public engine origin. When set, monitors push changes to our webhook instead of waiting for the poller.
const PUBLIC_API = process.env.FARADAY_DOMAIN ? `https://api.${process.env.FARADAY_DOMAIN}` : null;

export async function createSearchMonitor(name: string, query: string, instructions: string) {
  return ctx().monitors.create({
    ...(PUBLIC_API ? { webhook: { url: `${PUBLIC_API}/api/webhooks/context`, events: ["change.detected" as const] } } : {}),
    name: name.slice(0, 100),
    target: { type: "search", query: query.slice(0, 500), instructions: instructions.slice(0, 2000) },
    change_detection: { type: "semantic", confidence_threshold: 0.7 },
    schedule: { type: "interval", frequency: 10, unit: "minutes" },
    tags: ["faraday"],
  });
}
