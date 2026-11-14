import { decide } from "../../llm/decide";
import { THRESHOLDS } from "../../llm/thresholds";
import type { Usage } from "../../graph/runner";
import { sourceTypes, type Plan, type Source, type SourceType } from "../../spec";
import { LIMITS, pool } from "./util";

export type TriageRow = { id: string; relevance: number; sourceType: SourceType; hasFacts: number };
export type TriageResult = { rows: TriageRow[]; kept: string[]; dropped: string[]; failed: string[] };

const QUESTIONS = {
  onTopic: {
    type: "boolean" as const,
    instructions: "Is this source about this specific crisis, not a similar event elsewhere or at another time?",
  },
  type: {
    type: "choice" as const,
    instructions: "What kind of publisher is this?",
    criteria: {
      official: "Government, emergency service, utility or the affected organisation itself",
      news: "News outlet",
      social: "Social media or forum",
      aggregator: "Aggregator or reposter",
      other: "Anything else",
    },
  },
  hasFacts: {
    type: "boolean" as const,
    instructions: "Does the text state concrete figures, times, places or instructions?",
  },
};

/** Sources not triaged yet, most recent first, capped. */
export function untriaged(sources: Source[], cap = LIMITS.maxTriage): Source[] {
  return sources
    .filter((s) => s.relevance === null)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, cap);
}

export async function triage(plan: Plan, sources: Source[], use: Usage, signal: AbortSignal): Promise<TriageResult> {
  const failed: string[] = [];
  const rows = await pool(sources, LIMITS.triageConcurrency, async (s): Promise<TriageRow | null> => {
    try {
      const r = await decide(
        {
          crisis: plan.title,
          place: plan.location?.name ?? null,
          entities: plan.entities,
          watchFor: plan.monitor.instructions,
          source: { title: s.title, publisher: s.publisher, url: s.url, publishedAt: s.publishedAt, snippet: (s.snippet ?? "").slice(0, 1500) },
        },
        QUESTIONS,
        { signal },
      );
      use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
      const choice = r.answers.type.choice as SourceType;
      return {
        id: s.id,
        relevance: r.answers.onTopic.probability,
        sourceType: s.kind === "social" ? "social" : (sourceTypes as readonly string[]).includes(choice) ? choice : "other",
        hasFacts: r.answers.hasFacts.probability,
      };
    } catch (e) {
      if (signal.aborted) throw e;
      failed.push(s.id);
      return null;
    }
  });
  const ok = rows.filter((r): r is TriageRow => r !== null);
  if (sources.length > 0 && ok.length === 0) throw new Error(`triage failed for all ${sources.length} sources`);
  return {
    rows: ok,
    kept: ok.filter((r) => r.relevance >= THRESHOLDS.onTopic).map((r) => r.id),
    dropped: ok.filter((r) => r.relevance < THRESHOLDS.onTopic).map((r) => r.id),
    failed,
  };
}
