// OWNER: F-RUNTIME. Durable job queue on MariaDB (guide P2-1).
import { json, one, run, tx, all } from "../db/pool";

export type JobKind = "build" | "edit" | "poll" | "cleanup";
export type Job = {
  id: number;
  kind: JobKind;
  boardId: string;
  payload: Record<string, unknown> | null;
  status: "queued" | "running" | "done" | "failed";
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  createdAt: number;
};

type JobRow = {
  id: number;
  kind: JobKind;
  board_id: string;
  payload: string | null;
  status: Job["status"];
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: number;
  created_at: number;
};

const toJob = (r: JobRow): Job => ({
  id: Number(r.id),
  kind: r.kind,
  boardId: r.board_id,
  payload: json<Record<string, unknown>>(r.payload),
  status: r.status,
  priority: Number(r.priority),
  attempts: Number(r.attempts),
  maxAttempts: Number(r.max_attempts),
  runAfter: Number(r.run_after),
  createdAt: Number(r.created_at),
});

const DEFAULT_PRIORITY: Record<JobKind, number> = { build: 30, edit: 20, poll: 10, cleanup: 0 };
/** How long a claimed job waits when its board is busy with another job. */
export const BOARD_BUSY_DELAY_MS = 5_000;
const BACKOFF_BASE_MS = 10_000;

/** For kind "poll", a queued poll for the same board is reused instead of adding a second one. Returns the job id. */
export async function enqueue(
  kind: JobKind,
  boardId: string,
  payload?: Record<string, unknown> | null,
  opts?: { priority?: number; runAfter?: number; maxAttempts?: number },
): Promise<number> {
  const now = Date.now();
  const runAfter = opts?.runAfter ?? now;
  if (kind === "poll") {
    const existing = await one<{ id: number; run_after: number }>(
      `SELECT id, run_after FROM jobs WHERE board_id = ? AND kind = 'poll' AND status = 'queued' ORDER BY id LIMIT 1`,
      [boardId],
    );
    if (existing) {
      // A manual or webhook poll should not wait behind a scheduled one that is due later.
      if (runAfter < Number(existing.run_after)) {
        await run(`UPDATE jobs SET run_after = ?, payload = ? WHERE id = ? AND status = 'queued'`, [
          runAfter,
          payload ? JSON.stringify(payload) : null,
          existing.id,
        ]);
      }
      return Number(existing.id);
    }
  }
  const res = await run(
    `INSERT INTO jobs (kind, board_id, payload, status, priority, run_after, attempts, max_attempts, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?)`,
    [
      kind,
      boardId,
      payload ? JSON.stringify(payload) : null,
      opts?.priority ?? DEFAULT_PRIORITY[kind],
      runAfter,
      opts?.maxAttempts ?? (kind === "poll" ? 2 : 3),
      now,
    ],
  );
  return Number(res.insertId);
}

/** Claims one due job of the given kinds with SELECT ... FOR UPDATE SKIP LOCKED, and takes the board lock. */
export async function claim(workerId: string, kinds: JobKind[], now = Date.now()): Promise<Job | null> {
  if (!kinds.length) return null;
  const marks = kinds.map(() => "?").join(", ");
  // A few candidates so that one busy board does not starve the rest of the queue in this pass.
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await tx(async (db) => {
      const row = await db.one<JobRow>(
        `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? AND kind IN (${marks})
         ORDER BY priority DESC, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now, ...kinds],
      );
      if (!row) return { done: true as const, job: null };
      const jobId = Number(row.id);
      // cleanup jobs are not tied to a real board's lock.
      if (row.kind !== "cleanup") {
        const lock = await db.run(`UPDATE boards SET running_job_id = ? WHERE id = ? AND running_job_id IS NULL`, [
          jobId,
          row.board_id,
        ]);
        if (lock.affectedRows === 0) {
          const holder = await db.one<{ running_job_id: number | null }>(`SELECT running_job_id FROM boards WHERE id = ?`, [
            row.board_id,
          ]);
          if (!holder) {
            // The board was deleted: nothing to run.
            await db.run(`UPDATE jobs SET status = 'failed', error = 'board not found', finished_at = ? WHERE id = ?`, [now, jobId]);
            return { done: false as const, job: null };
          }
          if (Number(holder.running_job_id) !== jobId) {
            await db.run(`UPDATE jobs SET run_after = ? WHERE id = ?`, [now + BOARD_BUSY_DELAY_MS, jobId]);
            return { done: false as const, job: null };
          }
        }
      }
      await db.run(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = ?, heartbeat_at = ? WHERE id = ?`,
        [workerId, now, jobId],
      );
      return { done: true as const, job: toJob({ ...row, status: "running", attempts: Number(row.attempts) + 1 }) };
    });
    if (result.done) return result.job;
  }
  return null;
}

export async function heartbeat(jobId: number, now = Date.now()): Promise<void> {
  await run(`UPDATE jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'`, [now, jobId]);
}

async function releaseBoard(jobId: number) {
  await run(`UPDATE boards SET running_job_id = NULL WHERE running_job_id = ?`, [jobId]);
}

export async function complete(jobId: number): Promise<void> {
  await run(`UPDATE jobs SET status = 'done', finished_at = ?, error = NULL WHERE id = ?`, [Date.now(), jobId]);
  await releaseBoard(jobId);
}

/** Retries with backoff while attempts < maxAttempts, else marks failed. Always frees the board lock. */
export async function fail(jobId: number, error: string): Promise<{ willRetry: boolean }> {
  const row = await one<{ attempts: number; max_attempts: number }>(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`, [jobId]);
  const now = Date.now();
  const msg = error.slice(0, 4000);
  let willRetry = false;
  if (row && Number(row.attempts) < Number(row.max_attempts)) {
    willRetry = true;
    const delay = BACKOFF_BASE_MS * 2 ** Math.max(0, Number(row.attempts) - 1);
    await run(
      `UPDATE jobs SET status = 'queued', run_after = ?, error = ?, locked_by = NULL, heartbeat_at = NULL WHERE id = ?`,
      [now + delay, msg, jobId],
    );
  } else {
    await run(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`, [msg, now, jobId]);
  }
  await releaseBoard(jobId);
  return { willRetry };
}

/** Requeues running jobs whose heartbeat is older than staleMs and frees their board locks. */
export async function reclaimStale(staleMs: number, now = Date.now()): Promise<number> {
  const stale = await all<{ id: number; attempts: number; max_attempts: number; board_id: string }>(
    `SELECT id, attempts, max_attempts, board_id FROM jobs WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
    [now - staleMs],
  );
  for (const j of stale) {
    const id = Number(j.id);
    if (Number(j.attempts) < Number(j.max_attempts)) {
      await run(
        `UPDATE jobs SET status = 'queued', run_after = ?, locked_by = NULL, heartbeat_at = NULL, error = 'reclaimed after missed heartbeat'
         WHERE id = ? AND status = 'running'`,
        [now, id],
      );
    } else {
      await run(`UPDATE jobs SET status = 'failed', error = 'missed heartbeat, no attempts left', finished_at = ? WHERE id = ? AND status = 'running'`, [
        now,
        id,
      ]);
    }
    await releaseBoard(id);
  }
  return stale.length;
}

/** Jobs reclaimed into 'failed' by reclaimStale need their board marked; the worker reads these. */
export async function jobById(jobId: number): Promise<Job | null> {
  const r = await one<JobRow>(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
  return r ? toJob(r) : null;
}

export async function queueStats(): Promise<{ queued: Record<JobKind, number>; running: number; failedLastHour: number }> {
  const queued: Record<JobKind, number> = { build: 0, edit: 0, poll: 0, cleanup: 0 };
  for (const r of await all<{ kind: JobKind; n: number }>(`SELECT kind, COUNT(*) AS n FROM jobs WHERE status = 'queued' GROUP BY kind`)) {
    queued[r.kind] = Number(r.n);
  }
  const running = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'`);
  const failed = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND finished_at >= ?`, [
    Date.now() - 3_600_000,
  ]);
  return { queued, running: Number(running?.n ?? 0), failedLastHour: Number(failed?.n ?? 0) };
}

export async function hasPendingJob(boardId: string, kinds: JobKind[]): Promise<boolean> {
  if (!kinds.length) return false;
  const r = await one<{ id: number }>(
    `SELECT id FROM jobs WHERE board_id = ? AND status IN ('queued', 'running') AND kind IN (${kinds.map(() => "?").join(", ")}) LIMIT 1`,
    [boardId, ...kinds],
  );
  return !!r;
}

/** Number of queued build jobs, for the api's global limit. */
export async function queuedBuilds(): Promise<number> {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE kind = 'build' AND status IN ('queued', 'running')`);
  return Number(r?.n ?? 0);
}

/** Deletes finished jobs older than the given age. Called by the cleanup job. */
export async function pruneJobs(olderThanMs: number, now = Date.now()): Promise<number> {
  const r = await run(`DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at < ?`, [now - olderThanMs]);
  return Number(r.affectedRows);
}

/** Puts a running job back in the queue without counting the attempt (worker shutdown). Frees the board lock. */
export async function release(jobId: number): Promise<void> {
  await run(
    `UPDATE jobs SET status = 'queued', run_after = ?, attempts = GREATEST(attempts - 1, 0), locked_by = NULL, heartbeat_at = NULL
     WHERE id = ? AND status = 'running'`,
    [Date.now(), jobId],
  );
  await releaseBoard(jobId);
}

/** created_at of the newest job of this kind, or null. */
export async function lastJobCreatedAt(kind: JobKind): Promise<number | null> {
  const r = await one<{ t: number | null }>(`SELECT MAX(created_at) AS t FROM jobs WHERE kind = ?`, [kind]);
  return r?.t === null || r?.t === undefined ? null : Number(r.t);
}

/**
 * Boards stuck in a pipeline status with no build or edit job queued or running, e.g. after a reclaimed job ran out
 * of attempts. The worker marks them as failed.
 */
export async function orphanedBuildingBoards(olderThanMs: number, now = Date.now()): Promise<{ id: string; hasSpec: boolean }[]> {
  const rows = await all<{ id: string; has_spec: number }>(
    `SELECT b.id, (b.spec IS NOT NULL) AS has_spec FROM boards b
     WHERE b.status IN ('queued', 'planning', 'gathering', 'composing', 'watching') AND b.updated_at < ?
       AND b.running_job_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.board_id = b.id AND j.kind IN ('build', 'edit') AND j.status IN ('queued', 'running'))`,
    [now - olderThanMs],
  );
  return rows.map((r) => ({ id: r.id, hasSpec: Number(r.has_spec) === 1 }));
}
