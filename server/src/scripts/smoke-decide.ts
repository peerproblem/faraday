// One real decision call on each backend, plus one fast-model call: npm run smoke:decide
import { generateText, Output } from "ai";
import { z } from "zod";
import { __setDecisionFactoryForTest, decide, type Question } from "../llm/decide";
import { fastLlm, smartLlm } from "../llm/models";

const questions = {
  onTopic: { type: "boolean", instructions: "Is this source about this specific crisis, not a similar event elsewhere or at another time?" },
  type: {
    type: "choice",
    instructions: "What kind of publisher is this?",
    criteria: { official: "Government, emergency service or utility", news: "News outlet", other: "Anything else" },
  },
  severity: { type: "score", instructions: "How severe is the situation described?", criteria: ["Minor", "Serious", "Deadly"] },
} satisfies Record<string, Question>;

const state = {
  crisis: "Valencia floods, October 2026",
  source: { title: "Floods in Valencia: 12 dead, 3,000 evacuated as rain continues", publisher: "elpais.com" },
};

let failed = 0;
for (const backend of ["google", "openai"] as const) {
  process.env.DECISION_BACKEND = backend;
  __setDecisionFactoryForTest(null);
  try {
    const r = await decide(state, questions);
    console.log(JSON.stringify({ backend, ok: r.backend === backend, ran: r.backend, model: r.model, ms: r.ms, tokensIn: r.tokensIn, answers: r.answers }));
  } catch (e) {
    failed += 1;
    const err = e as { name?: string; message?: string; statusCode?: number };
    console.log(JSON.stringify({ backend, ok: false, error: err.name, status: err.statusCode ?? null, message: String(err.message).slice(0, 300) }));
  }
}

for (const [role, llm] of [["fast", fastLlm()], ["smart", smartLlm()]] as const) {
  const t0 = Date.now();
  try {
    const r = await generateText({
      ...llm,
      output: Output.object({ schema: z.object({ deaths: z.string().nullable(), quote: z.string() }) }),
      prompt: "From this text, give the death toll as written and the sentence that states it: 'Floods in Valencia have killed 12 people, officials said.'",
    });
    console.log(JSON.stringify({ role, model: llm.modelId, ms: Date.now() - t0, output: r.output, usage: r.usage }));
  } catch (e) {
    failed += 1;
    console.log(JSON.stringify({ role, model: llm.modelId, ok: false, message: String((e as Error).message).slice(0, 300) }));
  }
}
process.exit(failed ? 1 : 0);
