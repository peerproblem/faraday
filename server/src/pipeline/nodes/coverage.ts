import { generateText, Output } from "ai";
import { z } from "zod";
import { decide } from "../../llm/decide";
import { fastLlm } from "../../llm/models";
import { THRESHOLDS } from "../../llm/thresholds";
import type { Usage } from "../../graph/runner";
import type { Fact, Plan } from "../../spec";
import { call, factLine, newestFacts } from "./util";

export type CoverageResult = { answered: Record<string, number>; unanswered: { id: string; text: string }[] };

/** One decision per question (guide G2). */
export async function checkCoverage(plan: Plan, facts: Fact[], use: Usage, signal: AbortSignal): Promise<CoverageResult> {
  const lines = newestFacts(facts, 80).map(factLine);
  const answered: Record<string, number> = {};
  await Promise.all(
    plan.questions.map(async (q) => {
      const r = await decide(
        { question: q.text, crisis: plan.title, facts: lines },
        { answered: { type: "boolean" as const, instructions: "Do these facts answer the question, at least in part, with specifics?" } },
        { signal },
      );
      use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
      answered[q.id] = r.answers.answered.probability;
    }),
  );
  return { answered, unanswered: plan.questions.filter((q) => (answered[q.id] ?? 0) < THRESHOLDS.answered) };
}

const querySchema = z.object({ newsQueries: z.array(z.string()), webQueries: z.array(z.string()) });

/** At most 3 queries in total for the unanswered questions. */
export async function followUpQueries(plan: Plan, unanswered: { text: string }[], use: Usage, signal: AbortSignal) {
  const llm = fastLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema: querySchema }),
    system: `Write at most 3 search queries in total (news and web together) that would answer these open questions about "${plan.title}"${plan.location ? ` in ${plan.location.name}` : ""}. Name the specific place or organisation. Prefer official sources for web queries.`,
    prompt: `OPEN QUESTIONS:\n${unanswered.map((q) => `- ${q.text}`).join("\n")}\n\nALREADY SEARCHED:\n${[...plan.newsQueries, ...plan.webQueries].map((q) => `- ${q}`).join("\n")}`,
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  const news = r.output.newsQueries.filter(Boolean).slice(0, 3);
  const web = r.output.webQueries.filter(Boolean).slice(0, Math.max(0, 3 - news.length));
  return { newsQueries: news, webQueries: web };
}
