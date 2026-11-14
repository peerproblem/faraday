import { generateText } from "ai";
import { fastLlm } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import type { FactDiff, Plan } from "../../spec";
import { call } from "./util";

/** A template note when exactly one metric changed; null otherwise (then the model writes it). */
export function templateNote(plan: Plan, diff: FactDiff): string | null {
  if (diff.added.length !== 0 || diff.changed.length !== 1) return null;
  const c = diff.changed[0];
  if (c.kind !== "metric") return null;
  const label = plan.metrics.find((m) => m.key === c.key)?.label ?? c.key;
  return c.from ? `${label}: ${c.from} to ${c.to}` : `${label}: ${c.to}`;
}

export async function changeNote(plan: Plan, diff: FactDiff, lines: string[], use: Usage, signal: AbortSignal): Promise<string> {
  const t = templateNote(plan, diff);
  if (t) return t;
  const llm = fastLlm();
  const r = await generateText({
    ...call(llm),
    system: `Write one short sentence in English for the change log of a live crisis board: what is new. No preamble, no quotes.`,
    prompt: `ADDED: ${JSON.stringify(diff.added)}\nCHANGED: ${JSON.stringify(diff.changed)}\nNEW FACTS:\n${lines.slice(0, 30).join("\n")}`,
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  return r.text.trim().split("\n")[0].slice(0, 300) || "New information arrived";
}
