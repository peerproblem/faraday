// OWNER: F-RUNTIME. Run and step checkpoints (guide P2-2).
import { all, one, run } from "../db/pool";
import type { RunStepView, RunView } from "../spec";

export type GraphName = "build" | "edit" | "update";

type RunRow = {
  id: number;
  board_id: string;
  job_id: number;
  graph: GraphName;
  status: "running" | "done" | "failed";
  started_at: number;
  finished_at: number | null;
  error: string | null;
};

type StepRow = {
  id: number;
  run_id: number;
  node: string;
  step_key: string;
  status: RunStepView["status"];
  attempt: number;
  input_hash: string;
  output: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  context_calls: number | null;
  started_at: number;
  ms: number | null;
  error: string | null;
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * The latest run for this job that did not complete (interrupted or failed), reopened as running, if any.
 * A retried or reclaimed job resumes it, so steps that finished are not run again.
 */
export async function findUnfinishedRun(jobId: number): Promise<number | null> {
  const r = await one<{ id: number }>(
    `SELECT id FROM runs WHERE job_id = ? AND status IN ('running', 'failed') ORDER BY id DESC LIMIT 1`,
    [jobId],
  );
  if (!r) return null;
  await run(`UPDATE runs SET status = 'running', finished_at = NULL, error = NULL WHERE id = ?`, [r.id]);
  return Number(r.id);
}

export async function startRun(boardId: string, jobId: number, graph: GraphName): Promise<number> {
  const res = await run(`INSERT INTO runs (board_id, job_id, graph, status, started_at) VALUES (?, ?, ?, 'running', ?)`, [
    boardId,
    jobId,
    graph,
    Date.now(),
  ]);
  return Number(res.insertId);
}

export async function finishRun(runId: number, status: "done" | "failed", error: string | null = null): Promise<void> {
  await run(`UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`, [status, Date.now(), error?.slice(0, 4000) ?? null, runId]);
}

export type StoredStep = { status: RunStepView["status"]; inputHash: string; output: string | null; attempt: number };

export async function getStep(runId: number, node: string, stepKey: string): Promise<StoredStep | null> {
  const r = await one<StepRow>(`SELECT status, input_hash, output, attempt FROM run_steps WHERE run_id = ? AND node = ? AND step_key = ?`, [
    runId,
    node,
    stepKey,
  ]);
  return r ? { status: r.status, inputHash: r.input_hash, output: r.output, attempt: Number(r.attempt) } : null;
}

/** Inserts or resets the step row to running. Returns the attempt number. */
export async function beginStep(runId: number, node: string, stepKey: string, inputHash: string, attempt: number): Promise<void> {
  await run(
    `INSERT INTO run_steps (run_id, node, step_key, status, attempt, input_hash, started_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = 'running', attempt = VALUES(attempt), input_hash = VALUES(input_hash),
       started_at = VALUES(started_at), output = NULL, error = NULL, ms = NULL`,
    [runId, node, stepKey, attempt, inputHash, Date.now()],
  );
}

export async function endStep(
  runId: number,
  node: string,
  stepKey: string,
  r: {
    status: "done" | "failed" | "skipped";
    output?: string | null;
    ms: number;
    model?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    contextCalls?: number | null;
    error?: string | null;
  },
): Promise<void> {
  await run(
    `UPDATE run_steps SET status = ?, output = ?, ms = ?, model = ?, tokens_in = ?, tokens_out = ?, context_calls = ?, error = ?
     WHERE run_id = ? AND node = ? AND step_key = ?`,
    [
      r.status,
      r.output ?? null,
      Math.round(r.ms),
      r.model?.slice(0, 64) ?? null,
      r.tokensIn ?? null,
      r.tokensOut ?? null,
      r.contextCalls ?? null,
      r.error?.slice(0, 4000) ?? null,
      runId,
      node,
      stepKey,
    ],
  );
}

/** Inserts a skipped step row directly (optional step past the deadline). */
export async function skipStep(runId: number, node: string, stepKey: string, inputHash: string, reason: string): Promise<void> {
  await run(
    `INSERT INTO run_steps (run_id, node, step_key, status, attempt, input_hash, started_at, ms, error)
     VALUES (?, ?, ?, 'skipped', 1, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE status = 'skipped', ms = 0, error = VALUES(error)`,
    [runId, node, stepKey, inputHash, Date.now(), reason.slice(0, 4000)],
  );
}

export async function latestRunView(boardId: string): Promise<RunView> {
  const r = await one<RunRow>(`SELECT * FROM runs WHERE board_id = ? ORDER BY id DESC LIMIT 1`, [boardId]);
  const empty = { ms: null, llmCalls: 0, tokensIn: 0, tokensOut: 0, contextCalls: 0 };
  if (!r) return { run: null, steps: [], totals: empty };
  const rows = await all<StepRow>(
    `SELECT node, step_key, status, attempt, started_at, ms, model, tokens_in, tokens_out, context_calls, error
     FROM run_steps WHERE run_id = ? ORDER BY started_at, id`,
    [r.id],
  );
  const steps: RunStepView[] = rows.map((s) => ({
    node: s.node,
    stepKey: s.step_key,
    status: s.status,
    attempt: Number(s.attempt),
    startedAt: Number(s.started_at),
    ms: n(s.ms),
    model: s.model,
    tokensIn: n(s.tokens_in),
    tokensOut: n(s.tokens_out),
    contextCalls: n(s.context_calls),
    error: s.error,
  }));
  const startedAt = Number(r.started_at);
  const finishedAt = n(r.finished_at);
  return {
    run: { id: Number(r.id), graph: r.graph, status: r.status, startedAt, finishedAt, error: r.error },
    steps,
    totals: {
      ms: finishedAt !== null ? finishedAt - startedAt : null,
      llmCalls: steps.filter((s) => s.model).length,
      tokensIn: steps.reduce((a, s) => a + (s.tokensIn ?? 0), 0),
      tokensOut: steps.reduce((a, s) => a + (s.tokensOut ?? 0), 0),
      contextCalls: steps.reduce((a, s) => a + (s.contextCalls ?? 0), 0),
    },
  };
}

/** Average ms per node over the last hour, for /internal/stats. */
export async function nodeStats(sinceMs: number): Promise<{ node: string; count: number; avgMs: number; failed: number }[]> {
  const rows = await all<{ node: string; count: number; avg_ms: number | null; failed: number }>(
    `SELECT node, COUNT(*) AS count, AVG(CASE WHEN status = 'done' THEN ms END) AS avg_ms,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM run_steps WHERE started_at >= ? GROUP BY node ORDER BY node`,
    [sinceMs],
  );
  return rows.map((r) => ({ node: r.node, count: Number(r.count), avgMs: Math.round(Number(r.avg_ms ?? 0)), failed: Number(r.failed) }));
}

/** Clears stored outputs of old steps (cleanup job, guide P6-6). */
export async function pruneStepOutputs(olderThanMs: number, now = Date.now()): Promise<number> {
  const r = await run(`UPDATE run_steps SET output = NULL WHERE output IS NOT NULL AND started_at < ?`, [now - olderThanMs]);
  return Number(r.affectedRows);
}

/** Worker liveness (guide P6-5). */
export async function writeWorkerHeartbeat(workerId: string, now = Date.now()): Promise<void> {
  await run(`INSERT INTO worker_heartbeats (worker_id, ts) VALUES (?, ?) ON DUPLICATE KEY UPDATE ts = VALUES(ts)`, [workerId, now]);
}

export async function latestWorkerHeartbeat(): Promise<number | null> {
  const r = await one<{ ts: number | null }>(`SELECT MAX(ts) AS ts FROM worker_heartbeats`);
  return n(r?.ts);
}
