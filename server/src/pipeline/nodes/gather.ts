import { searchNews, searchWeb, type FoundDoc } from "../../contextdev";
import { gatherX } from "../../social/x";
import type { Usage } from "../../graph/runner";
import type { BoardTier, Plan } from "../../spec";

export type GatherResult = { docs: FoundDoc[]; calls: number; failures: string[] };

export function freshnessFor(lookbackDays: number) {
  return lookbackDays <= 1 ? ("last_24_hours" as const) : lookbackDays <= 7 ? ("last_week" as const) : ("last_month" as const);
}

export async function gather(
  q: { newsQueries: string[]; webQueries: string[]; socialQueries?: string[]; lookbackDays: Plan["lookbackDays"] },
  use: Usage,
  signal: AbortSignal,
  opts: { sinceMs?: number; newsLimit?: number; webResults?: number; boardId?: string; polling?: boolean; tier?: BoardTier } = {},
): Promise<GatherResult> {
  const sinceMs = opts.sinceMs ?? Date.now() - q.lookbackDays * 86_400_000;
  const freshness = freshnessFor(q.lookbackDays);
  const failures: string[] = [];
  const jobs: Promise<FoundDoc[]>[] = [
    ...q.newsQueries.slice(0, 5).map((query) =>
      searchNews(query, sinceMs, opts.newsLimit ?? 10, signal).catch((e) => {
        failures.push(`news "${query}": ${(e as Error).message}`);
        return [];
      }),
    ),
    ...q.webQueries.slice(0, 4).map((query) =>
      searchWeb(query, freshness, opts.webResults ?? 6, signal).catch((e) => {
        failures.push(`web "${query}": ${(e as Error).message}`);
        return [];
      }),
    ),
  ];
  const social = opts.boardId && q.socialQueries?.length
    ? gatherX(opts.boardId, q.socialQueries, signal, opts).catch(() => {
        failures.push("X social search failed (credentials, budget store or API unavailable)");
        return [] as FoundDoc[];
      })
    : Promise.resolve([] as FoundDoc[]);
  const [results, socialDocs] = await Promise.all([Promise.all(jobs), social]);
  use.context(jobs.length);
  return { docs: dedupeDocs([...results.flat(), ...socialDocs]), calls: jobs.length, failures };
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
 * Which news queries a poll uses. Rotates through all of them, 3 at a time, without stored state:
 * the slot advances every `periodMs`, so every query is used over a few polls (guide P1-2).
 */
export function rotateQueries(queries: string[], now: number, periodMs = 2 * 60_000, perPoll = 3): string[] {
  if (queries.length <= perPoll) return queries;
  const slots = Math.ceil(queries.length / perPoll);
  const slot = Math.floor(now / periodMs) % slots;
  const picked = queries.slice(slot * perPoll, slot * perPoll + perPoll);
  // The last slot may be short; top it up from the start.
  return picked.length < perPoll ? [...picked, ...queries.slice(0, perPoll - picked.length)] : picked;
}
