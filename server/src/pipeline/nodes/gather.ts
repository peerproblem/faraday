import { searchNews, searchWeb, type FoundDoc } from "../../contextdev";
import { recordContextSearch } from "../../repo/context-evidence";
import { gatherX } from "../../social/x";
import { oxylabsEnabled, oxySearch } from "../../oxylabs";
import type { Usage } from "../../graph/runner";
import type { BoardTier, Plan } from "../../spec";

export type GatherResult = {
  docs: FoundDoc[];
  /** Context.dev calls only. */
  calls: number;
  failures: string[];
  /** Oxylabs local search: results before dedupe, the ones no other source had, and the calls made. */
  localFound: number;
  localAdded: number;
  oxylabsCalls: number;
};

/** Local-language queries first, then the first web query, run from the crisis country. */
export function localSearchQueries(q: { localQueries?: string[]; webQueries: string[] }): string[] {
  return [...(q.localQueries ?? []).filter(Boolean).slice(0, 2), ...q.webQueries.slice(0, 1)];
}

export function freshnessFor(lookbackDays: number) {
  return lookbackDays <= 1 ? ("last_24_hours" as const) : lookbackDays <= 7 ? ("last_week" as const) : ("last_month" as const);
}

export async function gather(
  q: { newsQueries: string[]; webQueries: string[]; socialQueries?: string[]; localQueries?: string[]; lookbackDays: Plan["lookbackDays"] },
  use: Usage,
  signal: AbortSignal,
  opts: {
    sinceMs?: number;
    newsLimit?: number;
    webResults?: number;
    boardId?: string;
    polling?: boolean;
    tier?: BoardTier;
    /** ISO 3166-1 alpha-2 country of the crisis. Oxylabs local search runs only when set. */
    country?: string | null;
  } = {},
): Promise<GatherResult> {
  const sinceMs = opts.sinceMs ?? Date.now() - q.lookbackDays * 86_400_000;
  const freshness = freshnessFor(q.lookbackDays);
  const failures: string[] = [];
  const boardId = opts.boardId;
  const archive = boardId ? async (docs: FoundDoc[], pageIndex = 0) => {
    if (pageIndex > 0) use.context(1);
    await recordContextSearch(boardId, docs);
  } : undefined;
  const jobs: Promise<FoundDoc[]>[] = [
    ...q.newsQueries.slice(0, 5).map((query) =>
      searchNews(query, sinceMs, opts.newsLimit ?? 10, signal, archive).catch((e) => {
        failures.push(`news "${query}": ${(e as Error).message}`);
        return [];
      }),
    ),
    ...q.webQueries.slice(0, 4).map((query) =>
      searchWeb(query, freshness, opts.webResults ?? 6, signal, archive).catch((e) => {
        failures.push(`web "${query}": ${(e as Error).message}`);
        return [];
      }),
    ),
  ];
  const social = opts.boardId && q.socialQueries?.length
    ? gatherX(opts.boardId, q.socialQueries, signal, opts).catch((e) => {
        // The board only gets the generic line; the cause (an HTTP status, never a header or token) goes to the worker log.
        console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "x search failed", proc: "worker", boardId: opts.boardId, error: (e as Error).message }));
        failures.push("X social search failed (credentials, budget store or API unavailable)");
        return [] as FoundDoc[];
      })
    : Promise.resolve([] as FoundDoc[]);
  const country = opts.country ?? null;
  const localQs = country && oxylabsEnabled() ? localSearchQueries(q) : [];
  const local = Promise.all(
    localQs.map((query) =>
      oxySearch(query, { location: country ?? undefined, maxResults: 8, signal }).catch((e) => {
        failures.push(`Local search from ${country} failed: ${(e as Error).message}`);
        return [] as FoundDoc[];
      }),
    ),
  );
  const [results, socialDocs, localDocs] = await Promise.all([Promise.all(jobs), social, local]);
  use.context(jobs.length);
  // Context.dev first, so a URL both APIs found stays a Context.dev source; what remains from Oxylabs is new.
  const before = dedupeDocs([...results.flat(), ...socialDocs]);
  const docs = dedupeDocs([...before, ...localDocs.flat()]);
  return {
    docs,
    calls: jobs.length,
    failures,
    localFound: localDocs.flat().length,
    localAdded: docs.length - before.length,
    oxylabsCalls: localQs.length,
  };
}

export function dedupeDocs(docs: FoundDoc[]): FoundDoc[] {
  const seen = new Set<string>();
  const out: FoundDoc[] = [];
  for (const d of docs) {
    const key = d.url.split("#")[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * Which news queries a poll uses. Rotates through all of them, 2 at a time, without stored state:
 * the slot advances every `periodMs`, so every query is used over a few polls (guide P1-2).
 */
export function rotateQueries(queries: string[], now: number, periodMs = 10 * 60_000, perPoll = 2): string[] {
  if (queries.length <= perPoll) return queries;
  const slots = Math.ceil(queries.length / perPoll);
  const slot = Math.floor(now / periodMs) % slots;
  const picked = queries.slice(slot * perPoll, slot * perPoll + perPoll);
  // The last slot may be short; top it up from the start.
  return picked.length < perPoll ? [...picked, ...queries.slice(0, perPoll - picked.length)] : picked;
}
