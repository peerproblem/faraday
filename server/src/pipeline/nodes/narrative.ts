import { Output, streamText } from "ai";
import { z } from "zod";
import { smartLlm } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import type { Fact, Plan } from "../../spec";
import { call, factLine } from "./util";

const cited = z.object({ text: z.string(), facts: z.array(z.string()).describe("Fact ids like f12 that support this text") });
const schema = z.object({
  headline: cited.describe("One sentence: the state of things right now, with the latest figure that matters"),
  sentences: z.array(cited).describe("3 to 5 sentences: what happened, what is happening now, what happens next"),
});

export type Narrative = { headline: { text: string; sources: string[] } | null; sentences: { text: string; sources: string[] }[] };

/** Turns cited fact ids into the source ids of those facts. Unknown ids are dropped. */
export function citeSources(factIds: string[] | undefined, facts: Map<number, Fact>): string[] {
  const out = new Set<string>();
  for (const raw of factIds ?? []) {
    const id = Number(String(raw).replace(/^f/i, ""));
    for (const s of facts.get(id)?.sourceIds ?? []) out.add(s);
  }
  return [...out];
}

function convert(partial: unknown, byId: Map<number, Fact>): Narrative {
  const p = (partial ?? {}) as { headline?: { text?: string; facts?: string[] }; sentences?: ({ text?: string; facts?: string[] } | undefined)[] };
  return {
    headline: p.headline?.text ? { text: p.headline.text, sources: citeSources(p.headline.facts, byId) } : null,
    sentences: (p.sentences ?? [])
      .filter((s): s is { text: string; facts?: string[] } => !!s?.text)
      .map((s) => ({ text: s.text, sources: citeSources(s.facts, byId) })),
  };
}

/** Writes from verified facts only. onPartial receives converted partial results while the model streams. */
export async function writeNarrative(
  plan: Plan,
  facts: Fact[],
  use: Usage,
  signal: AbortSignal,
  onPartial?: (n: Narrative) => void,
  now = new Date(),
): Promise<Narrative> {
  const byId = new Map(facts.map((f) => [f.id, f]));
  if (facts.length === 0) return { headline: null, sentences: [] };
  const llm = smartLlm();
  const result = streamText({
    ...call(llm),
    output: Output.object({ schema }),
    system: `You write the situation summary of a live crisis board. Now: ${now.toISOString()}.
Write in ${plan.language}, plain and calm, for people affected and for responders.
Use only the facts given. Every sentence cites the fact ids it relies on. Prefer the newest figures. When facts disagree, say so. Never estimate.`,
    prompt: `BOARD: ${plan.title}${plan.location ? ` (${plan.location.name})` : ""}\n\nFACTS:\n${facts.slice(0, 150).map(factLine).join("\n")}`,
    abortSignal: signal,
  });
  let last = 0;
  for await (const partial of result.partialOutputStream) {
    if (onPartial && Date.now() - last > 500) {
      last = Date.now();
      onPartial(convert(partial, byId));
    }
  }
  const out = convert(await result.output, byId);
  use.llm(llm.modelId, await result.usage);
  return { headline: out.headline, sentences: out.sentences.slice(0, 6) };
}
