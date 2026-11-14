import { scrapeMarkdown } from "../../contextdev";
import { saveSourceText } from "../../repo/boards";
import type { Usage } from "../../graph/runner";
import type { Source } from "../../spec";
import { LIMITS, pool } from "./util";

/** Official sources first, then other web pages, by relevance. Monitors and news are read from their snippets. */
export function pickReadTargets(sources: Source[], max = LIMITS.maxScrapes(), alreadyRead: Set<string> = new Set()): Source[] {
  const score = (s: Source) => (s.sourceType === "official" ? 2 : s.kind === "web" ? 1 : 0) + (s.relevance ?? 0);
  return sources
    .filter((s) => s.kind !== "social")
    .filter((s) => !alreadyRead.has(s.id) && (s.sourceType === "official" || s.kind === "web"))
    .filter((s) => !/\.(pdf|jpg|png|gif|mp4)(\?|$)/i.test(s.url) || s.url.toLowerCase().includes(".pdf"))
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.max(0, max));
}

/**
 * Scrapes and stores Markdown. Returns the ids that were read (the text itself stays in source_texts).
 * `fresh` ids (pages a monitor saw change) are fetched with no cache; others use the default cache age.
 */
export async function readSources(
  boardId: string,
  targets: Source[],
  use: Usage,
  signal: AbortSignal,
  fresh: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const read = await pool(targets, 4, async (s) => {
    try {
      const md = await scrapeMarkdown(s.url, signal, fresh.has(s.id) ? { maxAgeMs: 0 } : {});
      use.context(1);
      if (!md || md.trim().length < 200) return null;
      await saveSourceText(boardId, s.id, md.slice(0, 200_000));
      return s.id;
    } catch {
      if (signal.aborted) throw new Error("aborted");
      return null;
    }
  });
  return read.filter((x): x is string => !!x);
}
