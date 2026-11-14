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

async function taped<T>(method: string, args: unknown[], live: () => Promise<T>): Promise<T> {
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

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

export function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function searchNews(query: string, sinceMs: number, limit = 10, signal?: AbortSignal): Promise<FoundDoc[]> {
  // Round the window to the hour so recorded cassettes match on replay within the same hour bucket.
  const from = Math.floor(sinceMs / 3_600_000) * 3_600_000;
  return taped("news.search", [query, cassetteMode() === "off" ? sinceMs : from, limit], async () => {
    const res = await ctx().news.search(
      { searchBy: { type: "natural_language", query }, filterBy: { date: { from: cassetteMode() === "off" ? sinceMs : from } }, limit },
      { signal },
    );
    return (res.data ?? []).map((a) => ({
      url: a.url,
      title: a.title ?? null,
      publisher: a.source?.name ?? a.source?.domain ?? null,
      publishedAt: a.published_at ?? null,
      snippet: clip(a.description, 1200),
      kind: "news" as const,
    }));
  });
}

export async function searchWeb(
  query: string,
  freshness: "last_24_hours" | "last_week" | "last_month" | "last_year",
  numResults = 6,
  signal?: AbortSignal,
): Promise<FoundDoc[]> {
  return taped("web.search", [query, freshness, numResults], async () => {
    const res = await ctx().web.search(
      { query, numResults, freshness, highlightsOptions: { enabled: true, maxCharacters: 1500 } },
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
}

/** Main content as Markdown, or null when the page cannot be read. */
export async function scrapeMarkdown(url: string, signal?: AbortSignal): Promise<string | null> {
  return taped("web.scrape", [url], async () => {
    try {
      const res = await ctx().web.scrape(
        {
          url,
          formats: { markdown: true },
          markdownParams: { includeImages: false, includeLinks: true },
          sharedParams: { mainContentOnly: true, dismissCookies: true, dismissPopups: true },
          timeoutOpts: { milliseconds: 25_000, behavior: "fail" },
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

export type MonitorChange = {
  monitorId: string;
  detectedAt: string;
  title: string;
  summary: string | null;
  url: string;
  importance: "low" | "medium" | "high" | null;
  evidence: FoundDoc[];
};
