import { scrapeMarkdown } from "../../contextdev";
import { oxylabsEnabled, oxyScrape } from "../../oxylabs";
import { saveSourceText } from "../../repo/boards";
import type { Usage } from "../../graph/runner";
import { isYleUrl } from "../../source-policy";
import type { Source } from "../../spec";
import { LIMITS, pool } from "./util";

/** Official sources first, then other web pages, by relevance. Monitors and news are read from their snippets. */
export function pickReadTargets(sources: Source[], max = LIMITS.maxScrapes(), alreadyRead: Set<string> = new Set()): Source[] {
  const score = (s: Source) => (s.sourceType === "official" ? 2 : s.kind === "web" ? 1 : 0) + (s.relevance ?? 0);
  return sources
    .filter((s) => s.kind !== "social" && !isYleUrl(s.url))
    .filter((s) => !alreadyRead.has(s.id) && (s.sourceType === "official" || s.kind === "web"))
    .filter((s) => !/\.(pdf|jpg|png|gif|mp4)(\?|$)/i.test(s.url) || s.url.toLowerCase().includes(".pdf"))
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.max(0, max));
}

/** Rendered Oxylabs retries per readSources call, for pages Context.dev could not read. */
export const MAX_RENDERED_RETRIES = 2;
const MIN_TEXT = 200;
const usable = (md: string | null | undefined): md is string => !!md && md.trim().length >= MIN_TEXT;

export type ReadStats = {
  /** Pages read through Oxylabs (sources it found, or rendered retries that worked). */
  oxylabsRead: number;
  /** Of those, pages Context.dev could not read. */
  rescued: number;
  /** Oxylabs scrape calls made. */
  oxylabsCalls: number;
};

/**
 * Scrapes and stores Markdown. Returns the ids that were read (the text itself stays in source_texts).
 * `fresh` ids (pages a monitor saw change) are fetched with no cache; others use the default cache age.
 * Sources Oxylabs found are read through Oxylabs from the crisis country first. Pages Context.dev cannot read
 * get one rendered Oxylabs retry, at most MAX_RENDERED_RETRIES per call.
 */
export async function readSources(
  boardId: string,
  targets: Source[],
  use: Usage,
  signal: AbortSignal,
  fresh: ReadonlySet<string> = new Set(),
  opts: { country?: string | null; onStats?: (stats: ReadStats) => void } = {},
): Promise<string[]> {
  const country = opts.country ?? null;
  const oxy = oxylabsEnabled();
  const stats: ReadStats = { oxylabsRead: 0, rescued: 0, oxylabsCalls: 0 };
  let renderedLeft = MAX_RENDERED_RETRIES;
  const read = await pool(targets.filter((s) => !isYleUrl(s.url)), 4, async (s) => {
    try {
      let md: string | null = null;
      if (oxy && s.via === "oxylabs") {
        stats.oxylabsCalls += 1;
        md = await oxyScrape(s.url, { location: country, signal });
        if (usable(md)) stats.oxylabsRead += 1;
      }
      if (!usable(md)) {
        md = await scrapeMarkdown(s.url, signal, fresh.has(s.id) ? { maxAgeMs: 0 } : {});
        use.context(1);
        if (!usable(md) && oxy && s.via !== "oxylabs" && renderedLeft > 0) {
          renderedLeft -= 1;
          stats.oxylabsCalls += 1;
          const rendered = await oxyScrape(s.url, { location: country, runJs: true, signal });
          if (usable(rendered)) {
            md = rendered;
            stats.oxylabsRead += 1;
            stats.rescued += 1;
          }
        }
      }
      if (!usable(md)) return null;
      await saveSourceText(boardId, s.id, md.slice(0, 200_000));
      return s.id;
    } catch {
      if (signal.aborted) throw new Error("aborted");
      return null;
    }
  });
  opts.onStats?.(stats);
  return read.filter((x): x is string => !!x);
}
