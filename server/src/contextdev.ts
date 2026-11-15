// Context.dev access with record/replay for evals: EVAL_RECORD=1 writes and EVAL_REPLAY=1 reads
// server/.eval/cassettes/<sha256 of method + args>.json. Replay never calls the network; a miss throws.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ContextDev from "context.dev";
import type { FoundDoc } from "./repo/boards";

export type { FoundDoc };

declare global {
  var __faradayCtx: ContextDev | undefined;
}

export function ctx(): ContextDev {
  globalThis.__faradayCtx ??= new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY, timeout: 60_000, maxRetries: 1 });
  return globalThis.__faradayCtx;
}

/** Test hook: use a fake client. */
export function __setContextClientForTest(client: unknown) {
  globalThis.__faradayCtx = client as ContextDev | undefined;
}

const DEFAULT_CASSETTE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.eval/cassettes");

/** EVAL_CASSETTE_DIR overrides the folder (tests use a temp dir). */
export const cassetteDir = () => process.env.EVAL_CASSETTE_DIR || DEFAULT_CASSETTE_DIR;

export function cassetteMode(): "record" | "replay" | "off" {
  if (process.env.EVAL_REPLAY === "1") return "replay";
  if (process.env.EVAL_RECORD === "1") return "record";
  return "off";
}

export function cassetteKey(method: string, args: unknown[]) {
  return createHash("sha256").update(`${method}\n${JSON.stringify(args)}`).digest("hex");
}

export class CassetteMissError extends Error {
  constructor(method: string, key: string) {
    super(`no cassette for ${method} (${key.slice(0, 12)}); record it with EVAL_RECORD=1`);
    this.name = "CassetteMissError";
  }
}

export async function taped<T>(method: string, args: unknown[], live: () => Promise<T>): Promise<T> {
  const mode = cassetteMode();
  if (mode === "off") return live();
  const key = cassetteKey(method, args);
  const dir = cassetteDir();
  const file = path.join(dir, `${key}.json`);
  if (mode === "replay") {
    try {
      return (JSON.parse(await readFile(file, "utf8")) as { result: T }).result;
    } catch {
      throw new CassetteMissError(method, key);
    }
  }
  const result = await live();
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ method, args, recordedAt: new Date().toISOString(), result }));
  return result;
}

const envMs = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/**
 * How old cached page content may be. Context.dev defaults are far too old for a live board (scrape: 3 days; the page
 * text behind search highlights: 365 days), and the search `freshness` filter only limits publish dates, not the cache.
 * Reads after a monitor change pass 0 to fetch the page as it is now.
 */
export const CACHE_MAX_AGE_MS = {
  get scrape() {
    return envMs("CONTEXT_SCRAPE_MAX_AGE_MS", 10 * 60_000);
  },
  get searchContent() {
    return envMs("CONTEXT_SEARCH_MAX_AGE_MS", 30 * 60_000);
  },
};

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

export function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export type SearchPageSink = (docs: FoundDoc[], pageIndex?: number) => Promise<void>;

export async function searchNews(
  query: string, sinceMs: number, limit = 10, signal?: AbortSignal, savePage?: SearchPageSink,
): Promise<FoundDoc[]> {
  // Round the window to the hour so recorded cassettes match on replay within the same hour bucket.
  const from = Math.floor(sinceMs / 3_600_000) * 3_600_000;
  const docs = await taped("news.search", [query, cassetteMode() === "off" ? sinceMs : from, limit], async () => {
    const results: FoundDoc[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pageIndex = 0;
    do {
      const res = await ctx().news.search(
        {
          searchBy: { type: "natural_language", query },
          filterBy: { date: { from: cassetteMode() === "off" ? sinceMs : from } },
          limit,
          ...(cursor ? { cursor } : {}),
        },
        { signal },
      );
      const page: FoundDoc[] = (res.data ?? []).map((a) => ({
        url: a.url,
        title: a.title ?? null,
        publisher: a.source?.name ?? a.source?.domain ?? null,
        publishedAt: a.published_at ?? null,
        snippet: clip(a.description, 1200),
        kind: "news",
        via: "contextdev",
      }));
      await savePage?.(page, pageIndex++);
      results.push(...page);
      if (!savePage || !res.has_more) break;
      if (!res.next_cursor || seenCursors.has(res.next_cursor)) throw new Error("Context.dev news pagination did not advance");
      cursor = res.next_cursor;
      seenCursors.add(cursor);
    } while (cursor);
    return results;
  });
  const tagged = docs.map((d) => ({ ...d, via: "contextdev" as const }));
  if (cassetteMode() === "replay") await savePage?.(tagged);
  // Additional result pages are evidence. Keep the normal board input at its existing limit.
  return savePage ? tagged.slice(0, limit) : tagged;
}

export async function searchWeb(
  query: string,
  freshness: "last_24_hours" | "last_week" | "last_month" | "last_year",
  numResults = 6,
  signal?: AbortSignal,
  savePage?: SearchPageSink,
): Promise<FoundDoc[]> {
  const docs = await taped("web.search", [query, freshness, numResults], async () => {
    const res = await ctx().web.search(
      {
        query,
        numResults,
        freshness,
        highlightsOptions: { enabled: true, maxCharacters: 1500 },
        // Highlights read each page with the markdownOptions settings; Markdown itself stays off.
        markdownOptions: { maxAgeMs: CACHE_MAX_AGE_MS.searchContent },
      },
      { signal },
    );
    return (res.results ?? []).map((r) => {
      const hl = r.highlights?.code === "SUCCESS" ? (r.highlights.highlights ?? []).join("\n") : null;
      return {
        url: r.url,
        title: r.title ?? null,
        publisher: hostOf(r.url),
        publishedAt: null,
        snippet: clip(hl || r.description, 1500),
        kind: "web" as const,
      };
    });
  });
  const tagged = docs.map((d) => ({ ...d, via: "contextdev" as const }));
  await savePage?.(tagged);
  return tagged;
}

/**
 * Main content as Markdown, or null when the page cannot be read. `maxAgeMs` caps the age of a cached copy
 * (default CACHE_MAX_AGE_MS.scrape; 0 fetches fresh). It is left out of the cassette key: replay returns the recording.
 */
export async function scrapeMarkdown(url: string, signal?: AbortSignal, opts: { maxAgeMs?: number } = {}): Promise<string | null> {
  const maxAgeMs = opts.maxAgeMs ?? CACHE_MAX_AGE_MS.scrape;
  return taped("web.scrape", [url], async () => {
    try {
      const res = await ctx().web.scrape(
        {
          url,
          formats: { markdown: true },
          markdownParams: { includeImages: false, includeLinks: true },
          sharedParams: { mainContentOnly: true, dismissCookies: true, dismissPopups: true },
          timeoutOpts: { milliseconds: 25_000, behavior: "fail" },
          maxAgeMs,
        },
        { signal },
      );
      const md = res.markdown?.success ? res.markdown.data : null;
      return md && md.trim() ? md : null;
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
  });
}

/**
 * One detected change. `title` and `summary` are written by Context.dev's judge model (semantic detection): they describe
 * the change for people and are never used as evidence for facts. `afterExcerpt` and `evidence[].after` are the raw page
 * text after the change.
 */
export type MonitorChange = {
  id: string;
  monitorId: string;
  detectedAt: string;
  title: string;
  summary: string | null;
  url: string;
  importance: "low" | "medium" | "high" | null;
  matchedUrls?: string[];
  addedUrls?: string[];
  removedUrls?: string[];
  beforeExcerpt?: string | null;
  diff?: string;
  snapshots?: { url: string | null; before: string; after: string }[];
  afterExcerpt: string | null;
  /** `url` is absent for whole-target diffs: the evidence is then about the change's own url. */
  evidence: { url: string | null; after: string }[];
};
