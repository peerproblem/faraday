// Oxylabs Web API (https://webapi.oxylabs.io): local search routed through a country, and page reads through
// that country's proxies with optional JavaScript rendering. Calls are taped like Context.dev for eval record/replay.
import { cassetteMode, hostOf, taped } from "./contextdev";
import type { FoundDoc } from "./repo/boards";

const BASE = "https://webapi.oxylabs.io/v1";
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TIMEOUT_MS = { search: 20_000, scrape: 30_000, render: 60_000 };

export const oxylabsEnabled = () => !!process.env.OXYLABS_WEB_API_KEY || cassetteMode() === "replay";

const countryCode = (location: string | null | undefined) => (location && /^[A-Z]{2}$/.test(location) ? location : null);

type SearchResponse = { results?: { title?: string | null; outline?: string[] | null; url?: string }[] };
type ScrapeResponse = { results?: { markdown?: string | null }[] };

/** Retry wait in ms; tests set it to 0. */
export const oxyRetry = { baseMs: 400 };

async function post<T>(path: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const key = process.env.OXYLABS_WEB_API_KEY;
  if (!key) throw new Error("OXYLABS_WEB_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: "error",
      });
    } catch {
      if (signal?.aborted) throw new Error("aborted");
      // Never forward a transport error, it may carry request headers.
      throw new Error(`Oxylabs ${path} transport failed`);
    }
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        throw new Error(`Oxylabs ${path} returned invalid JSON`);
      }
    }
    if (attempt === 0 && RETRY_STATUS.has(res.status) && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, oxyRetry.baseMs * (1 + Math.random())));
      continue;
    }
    let title = "";
    try {
      const p = (await res.json()) as { title?: unknown };
      if (typeof p?.title === "string" && /^[A-Z_]{1,64}$/.test(p.title)) title = ` ${p.title}`;
    } catch {
      // No problem+json body (401 has none).
    }
    throw new Error(`Oxylabs ${path} HTTP ${res.status}${title}`);
  }
}

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/** Approximate publish time from a leading relative age in a search outline ("2 days ago - ..."). */
export function outlineAge(text: string | null | undefined, now = Date.now()): string | null {
  const m = /^\s*(\d{1,3}|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago\b/i.exec(text ?? "");
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return new Date(now - n * UNIT_MS[m[2].toLowerCase()]).toISOString();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Web search, optionally from a country (ISO 3166-1 alpha-2). Throws on failure. */
export async function oxySearch(
  query: string,
  opts: { location?: string | null; maxResults?: number; signal?: AbortSignal } = {},
): Promise<FoundDoc[]> {
  const location = countryCode(opts.location);
  const maxResults = Math.min(20, Math.max(1, Math.round(opts.maxResults ?? 8)));
  const res = await taped("oxylabs.search", [query, location, maxResults], () =>
    post<SearchResponse>("/search", { query, max_results: maxResults, ...(location ? { location } : {}) }, TIMEOUT_MS.search, opts.signal),
  );
  return (res.results ?? []).flatMap((r): FoundDoc[] => {
    if (typeof r.url !== "string" || !/^https?:\/\//i.test(r.url)) return [];
    const outline = (r.outline ?? []).filter((o): o is string => typeof o === "string");
    const snippet = outline.join("\n").trim();
    return [
      {
        url: r.url,
        title: r.title ?? null,
        publisher: hostOf(r.url),
        publishedAt: outlineAge(outline[0]),
        snippet: snippet ? clip(snippet, 1500) : null,
        kind: "web",
        via: "oxylabs",
        geo: location,
      },
    ];
  });
}

/** A page as Markdown, read through a country's proxies when given. Null on any failure; throws only when aborted. */
export async function oxyScrape(
  url: string,
  opts: { location?: string | null; runJs?: boolean; signal?: AbortSignal } = {},
): Promise<string | null> {
  if (!oxylabsEnabled()) return null;
  const location = countryCode(opts.location);
  const runJs = !!opts.runJs;
  try {
    return await taped("oxylabs.scrape", [url, location, runJs], async () => {
      try {
        const res = await post<ScrapeResponse>(
          "/scrape",
          { url, output: ["markdown"], ...(location ? { location } : {}), ...(runJs ? { run_js: true } : {}) },
          runJs ? TIMEOUT_MS.render : TIMEOUT_MS.scrape,
          opts.signal,
        );
        const md = res.results?.[0]?.markdown;
        return typeof md === "string" && md.trim() ? md.trim() : null;
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        return null;
      }
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return null;
  }
}
