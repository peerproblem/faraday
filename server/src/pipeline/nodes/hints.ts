import { generateText, Output } from "ai";
import { z } from "zod";
import { fastLlm } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import type { Fact, Plan, StagedFact } from "../../spec";
import type { MergeHints } from "../merge";
import { call } from "./util";

export const EMPTY_HINTS: MergeHints = { keyAliases: {}, eventSameAs: {} };

/** Hints are only worth a model call when there are new metric keys or events that may duplicate each other. */
export function needsHints(current: Fact[], incoming: StagedFact[]): boolean {
  const newKeys = incoming.some((f) => f.kind === "metric" && f.key.startsWith("new:"));
  const events = incoming.filter((f) => f.kind === "event").length;
  const known = current.some((f) => f.kind === "event");
  return newKeys || events > 1 || (events > 0 && known);
}

const schema = z.object({
  keyAliases: z.array(z.object({ from: z.string().describe("a new:... key"), to: z.string().describe("an existing metric key, or the same new key to keep it") })),
  sameEvents: z.array(
    z.object({
      incoming: z.number().int().describe("index of an incoming event"),
      existingId: z.number().int().nullable().describe("id of an existing event it duplicates"),
      duplicateOf: z.number().int().nullable().describe("index of an earlier incoming event it duplicates"),
    }),
  ),
});

export async function makeHints(plan: Plan, current: Fact[], incoming: StagedFact[], use: Usage, signal: AbortSignal): Promise<MergeHints> {
  const newKeys = [...new Set(incoming.filter((f) => f.kind === "metric" && f.key.startsWith("new:")).map((f) => f.key))];
  const incomingEvents = incoming.map((f, i) => ({ f, i })).filter((x) => x.f.kind === "event");
  const existingEvents = current.filter((f) => f.kind === "event").slice(0, 80);
  const llm = fastLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema }),
    system: `You tidy facts for a crisis board before they are merged.
1. keyAliases: for each new:... metric key, map it to the existing metric key that measures the same thing, or to itself when it is genuinely new.
2. sameEvents: for incoming events that report the same real-world event as an existing event or an earlier incoming event, link them. Leave out events that are distinct.`,
    prompt: JSON.stringify({
      metrics: plan.metrics.map((m) => ({ key: m.key, label: m.label, unit: m.unit })),
      newKeys: newKeys.map((k) => ({ key: k, examples: incoming.filter((f) => f.key === k).slice(0, 2).map((f) => f.quote) })),
      existingEvents: existingEvents.map((f) => ({ id: f.id, title: (f.payload as { title: string }).title, asOf: f.asOf })),
      incomingEvents: incomingEvents.map(({ f, i }) => ({ index: i, title: (f.payload as { title: string }).title, asOf: f.asOf })),
    }),
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  return toHints(r.output, plan, incoming, current);
}

export function toHints(out: z.infer<typeof schema>, plan: Plan, incoming: StagedFact[], current: Fact[]): MergeHints {
  const keys = new Set(plan.metrics.map((m) => m.key));
  const keyAliases: Record<string, string> = {};
  for (const a of out.keyAliases) {
    if (!a.from.startsWith("new:")) continue;
    if (keys.has(a.to)) keyAliases[`metric:${a.from}`] = a.to;
  }
  const existingIds = new Set(current.filter((f) => f.kind === "event").map((f) => f.id));
  const eventSameAs: Record<number, number> = {};
  for (const s of out.sameEvents) {
    if (incoming[s.incoming]?.kind !== "event") continue;
    if (s.existingId !== null && existingIds.has(s.existingId)) eventSameAs[s.incoming] = s.existingId;
    else if (s.duplicateOf !== null && s.duplicateOf < s.incoming && incoming[s.duplicateOf]?.kind === "event") eventSameAs[s.incoming] = -1 - s.duplicateOf;
  }
  return { keyAliases, eventSameAs };
}
