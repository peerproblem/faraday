// Discovery: the fixed scan queries and the clustering call that groups articles into events.
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Usage } from "../../graph/runner";
import { fastLlm } from "../../llm/models";
import { crisisTypes, type CrisisType } from "../../spec";
import type { FoundDoc } from "../../repo/boards";
import { call } from "../nodes/util";

/** Broad English news queries, one or two per crisis type. Global, no region preference. */
export const DISCOVERY_QUERIES: readonly string[] = [
  "deadly flooding evacuations",
  "wildfire forces evacuation",
  "earthquake magnitude casualties",
  "hurricane typhoon cyclone landfall damage",
  "extreme heatwave deaths warning",
  "nationwide power outage",
  "ransomware cyberattack disrupts services",
  "disease outbreak cases health emergency",
  "airstrikes shelling civilians killed",
  "chemical plant explosion leak",
  "train derailment crash casualties",
  "state of emergency declared disaster",
];

export type Cluster = {
  title: string;
  crisisType: CrisisType;
  locationName: string | null;
  entities: string[];
  articleIdx: number[];
  ongoing: boolean;
};

const clusterSchema = z.object({
  events: z.array(
    z.object({
      title: z.string().describe("Short English event title naming the place, e.g. 'Valencia floods'"),
      crisisType: z.enum(crisisTypes),
      locationName: z.string().nullable().describe("Geocodable English place name, e.g. 'Valencia, Spain'; null when there is no physical place"),
      entities: z.array(z.string()).describe("2 to 6 proper names that identify this event: places, organisations, systems, named storms"),
      articleIdx: z.array(z.number().int()).describe("Indexes of the articles about this event"),
      ongoing: z.boolean().describe("True when the situation is still unfolding and affecting people now"),
    }),
  ),
});

const SYSTEM = (now: Date) => `You read a list of recent news articles and group the ones that report the same real-world crisis event.
Today is ${now.toISOString().slice(0, 10)}.
- One event per distinct incident: the same flood in the same region is one event; floods in two countries are two events.
- Only crises that harm people or infrastructure: disasters, outages, cyberattacks, outbreaks, armed conflict, industrial or transport accidents. Leave out politics, markets, sport, opinion and anniversaries of past events.
- Each article belongs to at most one event. Leave unrelated articles out.
- Write title, locationName and entities in English.`;

const MAX_ARTICLES = 150;

export const articleLine = (d: FoundDoc, i: number) =>
  `[${i}] ${d.publisher ?? "unknown"} | ${d.publishedAt ?? "date unknown"} | ${(d.title ?? d.url).slice(0, 200)}\n${(d.snippet ?? "").replace(/\s+/g, " ").slice(0, 300)}`;

/** Groups articles into events. Indexes the model invents or repeats are dropped; events without articles are dropped. */
export async function clusterArticles(docs: FoundDoc[], use: Usage, signal: AbortSignal, now = new Date()): Promise<Cluster[]> {
  const list = docs.slice(0, MAX_ARTICLES);
  if (!list.length) return [];
  const llm = fastLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema: clusterSchema }),
    system: SYSTEM(now),
    prompt: list.map(articleLine).join("\n\n"),
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  return normalizeClusters((r.output as z.infer<typeof clusterSchema>).events ?? [], list.length);
}

export function normalizeClusters(events: z.infer<typeof clusterSchema>["events"], n: number): Cluster[] {
  const taken = new Set<number>();
  const out: Cluster[] = [];
  for (const e of events) {
    const idx = [...new Set(e.articleIdx ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < n && !taken.has(i));
    if (!idx.length || !e.title?.trim()) continue;
    for (const i of idx) taken.add(i);
    out.push({
      title: e.title.trim().slice(0, 200),
      crisisType: (crisisTypes as readonly string[]).includes(e.crisisType) ? e.crisisType : "other",
      locationName: e.locationName?.trim() || null,
      entities: [...new Set((e.entities ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 8),
      articleIdx: idx,
      ongoing: e.ongoing !== false,
    });
  }
  return out;
}
