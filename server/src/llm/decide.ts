// Wrapper over experimental_decide (guide P0-4). Callers never import from "ai" for decisions.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, experimental_decide, type Experimental_DecisionModel } from "ai";

export type Question =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer<Q extends Question = Question> = Q extends { type: "boolean" }
  ? { type: "boolean"; probability: number }
  : Q extends { type: "choice" }
    ? { type: "choice"; choice: string; probabilities: Record<string, number> }
    : { type: "score"; score: number; probabilities: Record<string, number> };

export type DecideResult<Q extends Record<string, Question>> = {
  answers: { [K in keyof Q]: Answer<Q[K]> };
  backend: "google" | "openai";
  model: string;
  ms: number;
  tokensIn: number;
};

type Backend = "google" | "openai";
type DecisionState = Parameters<typeof experimental_decide>[0]["state"];
type Factory = (backend: Backend) => { model: Experimental_DecisionModel; modelId: string };

const defaultFactory: Factory = (backend) => {
  if (backend === "openai") {
    const modelId = process.env.DECISION_MODEL_OPENAI || "gpt-6-luna";
    return { model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).decisionModel(modelId), modelId };
  }
  const modelId = process.env.DECISION_MODEL_GOOGLE || "gemini-decision-1";
  return { model: createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY }).decisionModel(modelId), modelId };
};

let factory: Factory = defaultFactory;
const cache = new Map<Backend, { model: Experimental_DecisionModel; modelId: string }>();
let switchedToOpenai = false;
let consecutive5xx = 0;

/** Test hook: replace how decision models are built, and reset the fallback state. */
export function __setDecisionFactoryForTest(f: Factory | null) {
  factory = f ?? defaultFactory;
  cache.clear();
  switchedToOpenai = false;
  consecutive5xx = 0;
}

function modelFor(backend: Backend) {
  let m = cache.get(backend);
  if (!m) cache.set(backend, (m = factory(backend)));
  return m;
}

export function activeBackend(): Backend {
  if (switchedToOpenai) return "openai";
  return process.env.DECISION_BACKEND === "openai" ? "openai" : "google";
}

function statusOf(e: unknown): number | undefined {
  if (APICallError.isInstance(e)) return e.statusCode;
  const c = (e as { cause?: unknown })?.cause;
  if (c && APICallError.isInstance(c)) return c.statusCode;
  const s = (e as { statusCode?: unknown; status?: unknown })?.statusCode ?? (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isAuthError(e: unknown) {
  const s = statusOf(e);
  if (s === 401 || s === 403) return true;
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return /api key|permission|not allowed|early access|eap|unauthori[sz]ed|forbidden/.test(msg) && (s === undefined || s === 400);
}

function toState(state: unknown): DecisionState {
  if (typeof state === "string") return state;
  const plain = JSON.parse(JSON.stringify(state ?? null)) as unknown;
  if (plain && typeof plain === "object" && !Array.isArray(plain)) return plain as DecisionState;
  return { value: plain } as DecisionState;
}

type RawAnswer = { type: string; probability?: number; choice?: string; score?: number; probabilities?: Record<string, number> };

function normalize(q: Question, raw: RawAnswer | undefined): Answer {
  if (!raw) throw new Error("decision model returned no answer");
  if (q.type === "boolean") {
    if (raw.type !== "boolean" || typeof raw.probability !== "number") throw new Error(`expected a boolean answer, got ${raw.type}`);
    return { type: "boolean", probability: raw.probability };
  }
  if (q.type === "choice") {
    if (raw.type !== "choice" || typeof raw.choice !== "string") throw new Error(`expected a choice answer, got ${raw.type}`);
    return { type: "choice", choice: raw.choice, probabilities: raw.probabilities ?? { [raw.choice]: 1 } };
  }
  if (raw.type !== "score" || typeof raw.score !== "number") throw new Error(`expected a score answer, got ${raw.type}`);
  return { type: "score", score: raw.score, probabilities: raw.probabilities ?? {} };
}

async function callOnce<Q extends Record<string, Question>>(backend: Backend, state: unknown, questions: Q, signal?: AbortSignal) {
  const { model, modelId } = modelFor(backend);
  const t0 = Date.now();
  const r = await experimental_decide({ model, state: toState(state), questions, abortSignal: signal, maxRetries: 1 });
  const answers = {} as { [K in keyof Q]: Answer<Q[K]> };
  for (const id of Object.keys(questions) as (keyof Q & string)[]) {
    answers[id] = normalize(questions[id], (r.answers as Record<string, RawAnswer>)[id]) as Answer<Q[typeof id]>;
  }
  return { answers, backend, model: modelId, ms: Date.now() - t0, tokensIn: r.usage.inputTokens ?? 0 };
}

/**
 * DECISION_BACKEND=google|openai (default google). On a google auth error or 3 consecutive 5xx, falls back to openai
 * for the rest of the process lifetime and logs once.
 */
export async function decide<Q extends Record<string, Question>>(
  state: unknown,
  questions: Q,
  opts?: { signal?: AbortSignal },
): Promise<DecideResult<Q>> {
  const backend = activeBackend();
  if (backend === "openai") return callOnce("openai", state, questions, opts?.signal);
  try {
    const r = await callOnce("google", state, questions, opts?.signal);
    consecutive5xx = 0;
    return r;
  } catch (e) {
    if (opts?.signal?.aborted) throw e;
    const s = statusOf(e);
    if (s !== undefined && s >= 500) consecutive5xx += 1;
    const auth = isAuthError(e);
    if (!auth && consecutive5xx < 3) throw e;
    switchedToOpenai = true;
    console.warn(`[faraday] decisions: switching to openai (${auth ? "google auth error" : "3 consecutive google 5xx"}): ${(e as Error).message}`);
    return callOnce("openai", state, questions, opts?.signal);
  }
}
