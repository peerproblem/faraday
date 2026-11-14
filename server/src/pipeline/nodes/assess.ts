import { decide } from "../../llm/decide";
import { THRESHOLDS } from "../../llm/thresholds";
import type { Usage } from "../../graph/runner";
import { situationStatuses, type Fact, type FactDiff, type HeaderData, type Plan, type SituationStatus } from "../../spec";
import { factLine } from "./util";

export type Assessment = { status: SituationStatus; statusP: Record<string, number>; severity: number; severityP: Record<string, number> };

const SEVERITY = [
  "Minor: limited, local disruption, no serious harm reported",
  "Moderate: notable disruption or damage, few injuries",
  "Serious: widespread disruption, injuries or evacuations",
  "Severe: deaths, large evacuations or critical services down",
  "Catastrophic: mass casualties or a region-wide breakdown",
];

/** Severity 1 to 5 and situation status (guide G5). */
export async function assess(plan: Plan, facts: Fact[], use: Usage, signal: AbortSignal): Promise<Assessment> {
  const r = await decide(
    { crisis: plan.title, type: plan.crisisType, place: plan.location?.name ?? null, facts: facts.slice(0, 100).map(factLine) },
    {
      severity: { type: "score" as const, instructions: "How severe is this crisis right now, judging only from these facts?", criteria: SEVERITY },
      status: {
        type: "choice" as const,
        instructions: "What is the state of the crisis right now?",
        criteria: {
          developing: "Still unfolding, the situation is getting worse or is unclear",
          ongoing: "Continuing at a steady level",
          contained: "No longer spreading or growing, response under way",
          recovering: "Over, recovery and repairs under way",
          resolved: "Over and services restored",
        },
      },
    },
    { signal },
  );
  use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
  const severityP: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.answers.severity.probabilities)) severityP[String(Number(k) + 1)] = v;
  const choice = r.answers.status.choice as SituationStatus;
  return {
    severity: Math.min(5, Math.max(1, r.answers.severity.score + 1)),
    severityP,
    status: (situationStatuses as readonly string[]).includes(choice) ? choice : "developing",
    statusP: r.answers.status.probabilities,
  };
}

export type Materiality = { material: boolean; probability: number; importance: "low" | "medium" | "high" };

/** Does this change matter enough to rewrite the summary and alert viewers? (guide G3) */
export async function materiality(header: HeaderData | null, diff: FactDiff, changedLines: string[], use: Usage, signal: AbortSignal): Promise<Materiality> {
  const r = await decide(
    {
      board: header ? { title: header.title, headline: header.headline?.text ?? null, status: header.status, severity: header.severity } : null,
      added: diff.added,
      changed: diff.changed,
      newFacts: changedLines.slice(0, 40),
    },
    {
      material: {
        type: "boolean" as const,
        instructions: "Does this change the picture for people affected: a new or changed key figure, a new major event, a new warning, a status change?",
      },
      importance: { type: "score" as const, instructions: "How important is this change for people affected?", criteria: ["Low: a detail", "Medium: worth noting", "High: people should know now"] },
    },
    { signal },
  );
  use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
  const s = r.answers.importance.score;
  return {
    material: r.answers.material.probability >= THRESHOLDS.material,
    probability: r.answers.material.probability,
    importance: s >= 1.5 ? "high" : s >= 0.5 ? "medium" : "low",
  };
}
