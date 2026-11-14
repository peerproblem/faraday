import { searchNews, searchWeb, type FoundDoc } from "../contextdev";
import type { Plan } from "./plan";

export type GatherResult = { docs: FoundDoc[]; calls: number; failures: string[] };

export async function gather(
  plan: Pick<Plan, "newsQueries" | "webQueries" | "lookbackDays">,
  opts: { sinceMs?: number; newsLimit?: number; webResults?: number } = {},
): Promise<GatherResult> {
  const sinceMs = opts.sinceMs ?? Date.now() - plan.lookbackDays * 86_400_000;
  const freshness = plan.lookbackDays <= 1 ? "last_24_hours" : plan.lookbackDays <= 7 ? "last_week" : "last_month";
  const failures: string[] = [];
  const jobs: Promise<FoundDoc[]>[] = [
    ...plan.newsQueries.slice(0, 5).map((q) =>
      searchNews(q, sinceMs, opts.newsLimit ?? 10).catch((e) => {
        failures.push(`news "${q}": ${(e as Error).message}`);
        return [];
      }),
    ),
    ...plan.webQueries.slice(0, 4).map((q) =>
      searchWeb(q, freshness, opts.webResults ?? 6).catch((e) => {
        failures.push(`web "${q}": ${(e as Error).message}`);
        return [];
      }),
    ),
  ];
  const results = await Promise.all(jobs);
  const seen = new Set<string>();
  const docs: FoundDoc[] = [];
  for (const doc of results.flat()) {
    const key = doc.url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push(doc);
  }
  return { docs, calls: jobs.length, failures };
}
