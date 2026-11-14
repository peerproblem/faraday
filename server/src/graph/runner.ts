// OWNER: F-RUNTIME. Checkpointed graph runner (guide P2-2). Graphs are plain async code that call ctx.step().
import { createHash } from "node:crypto";
import { publish } from "../bus";
import { addEvent } from "../repo/boards";
import { heartbeat, type Job } from "../repo/jobs";
import { beginStep, endStep, findUnfinishedRun, finishRun, getStep, skipStep, startRun, type GraphName } from "../repo/runs";
import type { BoardEvent, StreamMsg } from "../spec";

export type Usage = {
  /** Record one model call. Pass the AI SDK `usage` object as is. */
  llm(model: string, usage?: { inputTokens?: number; outputTokens?: number } | null): void;
  /** Record Context.dev calls (default 1). */
  context(calls?: number): void;
};

export type StepOpts = {
  /** Distinguishes repeated calls of the same node in one run, e.g. a batch index. */
  key?: string;
  timeoutMs: number;
  retries?: number;
  /** Failure (or passing the run deadline) returns `fallback` instead of failing the run. */
  optional?: boolean;
  fallback?: unknown;
  /** Optional, but still run after the deadline (cheap steps the board needs, like monitor setup). */
  deadlineExempt?: boolean;
};

export interface RunCtx {
  boardId: string;
  runId: number;
  job: Job;
  signal: AbortSignal;
  /** Epoch ms. Optional steps that would start after this are skipped. */
  deadline: number;
  /**
   * Runs fn once per (node, key) in this run. If a done row with the same input hash exists (a resumed run),
   * returns its stored output without calling fn. Output must be JSON-serialisable.
   */
  step<I, O>(node: string, input: I, fn: (input: I, use: Usage, signal: AbortSignal) => Promise<O>, opts: StepOpts): Promise<O>;
  /** Promise.all with a concurrency limit. */
  map<T, O>(items: T[], limit: number, fn: (item: T, i: number) => Promise<O>): Promise<O[]>;
  /** Sends a stream message to the board's viewers. Not stored. */
  emit(msg: StreamMsg): void;
  /** Stores an event and streams it. */
  event(kind: BoardEvent["kind"], message: string, data?: Record<string, unknown> | null): Promise<BoardEvent>;
}

export type GraphFn = (ctx: RunCtx) => Promise<void>;

export class StepError extends Error {
  constructor(
    readonly node: string,
    readonly cause: unknown,
  ) {
    super(`${node}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "StepError";
  }
}

const DEFAULT_DEADLINES: Record<GraphName, number> = {
  build: Number(process.env.BUILD_DEADLINE_MS ?? 150_000),
  edit: 120_000,
  update: 60_000,
};
const HEARTBEAT_MS = 10_000;
const RETRY_BASE_MS = Number(process.env.STEP_RETRY_BASE_MS ?? 500);

/** JSON with sorted object keys, so equal inputs hash equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Map) return Object.fromEntries([...v.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
    if (v instanceof Set) return [...v];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

export const hashInput = (input: unknown) => createHash("sha256").update(stableJson(input ?? null)).digest("hex");

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** Runs fn with a signal that aborts on timeout or when the parent aborts; rejects on timeout even if fn ignores it. */
async function withTimeout<T>(ms: number, parent: AbortSignal, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const onParent = () => ctl.abort(parent.reason);
  if (parent.aborted) ctl.abort(parent.reason);
  else parent.addEventListener("abort", onParent, { once: true });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new TimeoutError(ms);
      ctl.abort(e);
      reject(e);
    }, ms);
  });
  try {
    return await Promise.race([fn(ctl.signal), timeout]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParent);
  }
}

export async function mapLimit<T, O>(items: T[], limit: number, fn: (item: T, i: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Starts or resumes a run for this job (resume = same job id), executes the graph, finishes the run row. */
export async function runGraph(graph: GraphName, job: Job, fn: GraphFn, opts?: { deadlineMs?: number; signal?: AbortSignal }): Promise<void> {
  const boardId = job.boardId;
  const runId = (await findUnfinishedRun(job.id)) ?? (await startRun(boardId, job.id, graph));
  const ctl = new AbortController();
  const outer = opts?.signal;
  const onOuter = () => ctl.abort(outer?.reason);
  if (outer?.aborted) ctl.abort(outer.reason);
  else outer?.addEventListener("abort", onOuter, { once: true });
  const deadline = Date.now() + (opts?.deadlineMs ?? DEFAULT_DEADLINES[graph]);
  const beat = setInterval(() => void heartbeat(job.id).catch(() => {}), HEARTBEAT_MS);
  beat.unref?.();

  const ctx: RunCtx = {
    boardId,
    runId,
    job,
    signal: ctl.signal,
    deadline,
    async step(node, input, stepFn, o) {
      const key = o.key ?? "";
      const inputHash = hashInput(input);
      const stored = await getStep(runId, node, key);
      if (stored && stored.status === "done" && stored.inputHash === inputHash) {
        return (stored.output === null ? undefined : JSON.parse(stored.output)) as Awaited<ReturnType<typeof stepFn>>;
      }
      if (o.optional && !o.deadlineExempt && Date.now() >= deadline) {
        await skipStep(runId, node, key, inputHash, "past run deadline");
        return o.fallback as Awaited<ReturnType<typeof stepFn>>;
      }
      const retries = Math.max(0, o.retries ?? 0);
      let lastErr: unknown;
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        if (ctl.signal.aborted) throw ctl.signal.reason ?? new Error("run aborted");
        const usage = { model: null as string | null, tokensIn: 0, tokensOut: 0, llmCalls: 0, context: 0 };
        const use: Usage = {
          llm(model, u) {
            usage.model = model;
            usage.llmCalls += 1;
            usage.tokensIn += u?.inputTokens ?? 0;
            usage.tokensOut += u?.outputTokens ?? 0;
          },
          context(calls = 1) {
            usage.context += calls;
          },
        };
        await beginStep(runId, node, key, inputHash, attempt);
        const t0 = Date.now();
        try {
          const out = await withTimeout(o.timeoutMs, ctl.signal, (signal) => stepFn(input, use, signal));
          await endStep(runId, node, key, {
            status: "done",
            output: out === undefined ? null : JSON.stringify(out),
            ms: Date.now() - t0,
            model: usage.model,
            tokensIn: usage.llmCalls ? usage.tokensIn : null,
            tokensOut: usage.llmCalls ? usage.tokensOut : null,
            contextCalls: usage.context || null,
          });
          return out;
        } catch (e) {
          lastErr = e;
          await endStep(runId, node, key, {
            status: "failed",
            ms: Date.now() - t0,
            model: usage.model,
            tokensIn: usage.llmCalls ? usage.tokensIn : null,
            tokensOut: usage.llmCalls ? usage.tokensOut : null,
            contextCalls: usage.context || null,
            error: errText(e),
          }).catch(() => {});
          if (ctl.signal.aborted) break;
          if (attempt <= retries) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1), ctl.signal).catch(() => {});
        }
      }
      if (o.optional && !ctl.signal.aborted) return o.fallback as Awaited<ReturnType<typeof stepFn>>;
      throw new StepError(node, lastErr);
    },
    map: mapLimit,
    emit(msg) {
      try {
        publish(boardId, msg);
      } catch {}
    },
    async event(kind, message, data = null) {
      const ev = await addEvent(boardId, kind, message, data);
      try {
        publish(boardId, { type: "event", event: ev });
      } catch {}
      return ev;
    },
  };

  try {
    await fn(ctx);
    await finishRun(runId, "done");
  } catch (e) {
    // An aborted run (worker shutting down) stays 'running' so the requeued job resumes it.
    if (!ctl.signal.aborted) await finishRun(runId, "failed", errText(e)).catch(() => {});
    throw e;
  } finally {
    clearInterval(beat);
    outer?.removeEventListener("abort", onOuter);
  }
}
