import { beforeAll, describe, expect, it, vi } from "vitest";

const published: unknown[] = [];
vi.mock("../bus", () => ({
  publish: (_boardId: string, msg: unknown) => published.push(msg),
  setBusMode: () => {},
  subscribe: () => () => {},
  subscriberCount: () => 0,
}));
vi.mock("../repo/boards", () => ({
  addEvent: async (_b: string, kind: string, message: string, data: unknown) => ({ id: 1, ts: Date.now(), kind, message, data: data ?? null }),
}));

process.env.STEP_RETRY_BASE_MS = "5";

import { all, one, run } from "../db/pool";
import { claim, enqueue, type Job } from "../repo/jobs";
import { latestRunView } from "../repo/runs";
import { useTestDb } from "../test/db";
import { hashInput, mapLimit, runGraph, stableJson, StepError } from "./runner";

const t = useTestDb("runtime_runner");

let seq = 0;
async function newJob(): Promise<Job> {
  const id = `r${Date.now().toString(36)}${seq++}`;
  const now = Date.now();
  await run(`INSERT INTO boards (id, slug, prompt, status, created_at, updated_at) VALUES (?, ?, 'p', 'queued', ?, ?)`, [id, id, now, now]);
  const jobId = await enqueue("build", id, {});
  const j = await claim("test", ["build"]);
  expect(j?.id).toBe(jobId);
  return j!;
}

describe("stable hashing", () => {
  it("ignores key order", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashInput({ x: [1, 2] })).not.toBe(hashInput({ x: [2, 1] }));
  });
  it("mapLimit keeps order and limits concurrency", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, n * 3));
      live--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});

describe.skipIf(!t.enabled)("runGraph", () => {
  beforeAll(() => {
    published.length = 0;
  });

  it("records steps and usage, and resumes a failed run without redoing done steps", async () => {
    const job = await newJob();
    const calls = { a: 0, b: 0 };
    let failB = true;
    const graph = async (ctx: Parameters<Parameters<typeof runGraph>[2]>[0]) => {
      const a = await ctx.step(
        "a",
        { q: 1 },
        async (input, use) => {
          calls.a++;
          use.llm("m-fast", { inputTokens: 10, outputTokens: 5 });
          use.context(2);
          return { v: input.q + 1 };
        },
        { timeoutMs: 1000 },
      );
      await ctx.step(
        "b",
        a,
        async () => {
          calls.b++;
          if (failB) throw new Error("b broke");
          return "ok";
        },
        { timeoutMs: 1000 },
      );
      ctx.emit({ type: "partial", stage: "b" });
      await ctx.event("stage", "done");
    };
    await expect(runGraph("build", job, graph)).rejects.toBeInstanceOf(StepError);
    const failedRun = await one<{ id: number; status: string }>(`SELECT id, status FROM runs WHERE job_id = ?`, [job.id]);
    expect(failedRun?.status).toBe("failed");

    failB = false;
    await runGraph("build", job, graph);
    expect(calls).toEqual({ a: 1, b: 2 });
    const runs = await all<{ id: number; status: string }>(`SELECT id, status FROM runs WHERE job_id = ?`, [job.id]);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("done");

    const view = await latestRunView(job.boardId);
    expect(view.run?.status).toBe("done");
    const stepA = view.steps.find((s) => s.node === "a");
    expect(stepA).toMatchObject({ status: "done", model: "m-fast", tokensIn: 10, tokensOut: 5, contextCalls: 2 });
    expect(view.totals.contextCalls).toBe(2);
    expect(published.some((m) => (m as { type: string }).type === "event")).toBe(true);
  });

  it("re-runs a done step when its input changed", async () => {
    const job = await newJob();
    let n = 0;
    let input = 1;
    const graph = async (ctx: Parameters<Parameters<typeof runGraph>[2]>[0]) => {
      await ctx.step("x", { input }, async () => ++n, { timeoutMs: 1000 });
      if (input === 1) throw new Error("stop");
    };
    await expect(runGraph("edit", job, graph)).rejects.toThrow("stop");
    input = 2;
    await runGraph("edit", job, graph);
    expect(n).toBe(2);
  });

  it("times out, retries, and falls back for optional steps", async () => {
    const job = await newJob();
    let attempts = 0;
    let sawAbort = false;
    const results: unknown[] = [];
    await runGraph("update", job, async (ctx) => {
      results.push(
        await ctx.step(
          "flaky",
          null,
          async () => {
            attempts++;
            if (attempts < 3) throw new Error("try again");
            return "third time";
          },
          { timeoutMs: 1000, retries: 2 },
        ),
      );
      results.push(
        await ctx.step(
          "slow",
          null,
          (_i, _u, signal) =>
            new Promise((resolve) => {
              signal.addEventListener("abort", () => {
                sawAbort = true;
              });
              setTimeout(() => resolve("late"), 500);
            }),
          { timeoutMs: 30, optional: true, fallback: "fallback" },
        ),
      );
    });
    expect(attempts).toBe(3);
    expect(results).toEqual(["third time", "fallback"]);
    expect(sawAbort).toBe(true);
    const view = await latestRunView(job.boardId);
    expect(view.steps.find((s) => s.node === "slow")?.status).toBe("failed");
    expect(view.steps.find((s) => s.node === "flaky")?.attempt).toBe(3);
  });

  it("fails a required step that times out", async () => {
    const job = await newJob();
    await expect(
      runGraph("build", job, async (ctx) => {
        await ctx.step("hang", null, () => new Promise(() => {}), { timeoutMs: 20 });
      }),
    ).rejects.toThrow(/hang: timed out/);
  });

  it("skips optional steps past the deadline", async () => {
    const job = await newJob();
    let ran = false;
    let got: unknown;
    await runGraph(
      "build",
      job,
      async (ctx) => {
        await new Promise((r) => setTimeout(r, 15));
        got = await ctx.step("late", null, async () => ((ran = true), "x"), { timeoutMs: 1000, optional: true, fallback: [] });
      },
      { deadlineMs: 5 },
    );
    expect(ran).toBe(false);
    expect(got).toEqual([]);
    const view = await latestRunView(job.boardId);
    expect(view.steps.find((s) => s.node === "late")?.status).toBe("skipped");
  });

  it("leaves an aborted run open so the job can resume it", async () => {
    const job = await newJob();
    const ctl = new AbortController();
    const p = runGraph(
      "build",
      job,
      async (ctx) => {
        await ctx.step("first", null, async () => 1, { timeoutMs: 1000 });
        ctl.abort(new Error("shutdown"));
        await ctx.step("second", null, async () => 2, { timeoutMs: 1000 });
      },
      { signal: ctl.signal },
    );
    await expect(p).rejects.toBeTruthy();
    const r = await one<{ status: string }>(`SELECT status FROM runs WHERE job_id = ?`, [job.id]);
    expect(r?.status).toBe("running");
  });
});
