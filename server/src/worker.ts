// OWNER: F-RUNTIME. Worker entry point: queue consumers, scheduler and tiering, stale job reclaim, cleanup, heartbeat.
// Graph registry: build -> buildGraph, edit -> editGraph, poll -> updateGraph, discover -> discoverGraph
// (from ./pipeline/graphs), cleanup -> local.
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { flushRemote, publish, setBusMode } from "./bus";
import { closePool } from "./db/pool";
import { runGraph, type GraphFn } from "./graph/runner";
import { removeBoardMonitors, setBoardMonitorSchedule } from "./monitors";
import { buildGraph, discoverGraph, editGraph, updateGraph } from "./pipeline/graphs";
import {
  addEvent,
  getBoard,
  listDueBoards,
  listLiveBoardsForTiering,
  listMonitors,
  pruneOldData,
  setSchedule,
  setStatus,
} from "./repo/boards";
import {
  claim,
  complete,
  enqueue,
  fail,
  hasPendingJob,
  lastJobCreatedAt,
  orphanedBuildingBoards,
  pruneJobs,
  reclaimStale,
  release,
  type Job,
  type JobKind,
} from "./repo/jobs";
import { discoverEnabled } from "./repo/settings";
import { pruneStepOutputs, writeWorkerHeartbeat, type GraphName } from "./repo/runs";
import { allowanceAt, archivePausedTopics, rankedTopicIds, recomputeRanks } from "./repo/topics";
import type { BoardStatus, BoardTier } from "./spec";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const SYSTEM_BOARD = "__system__";

export const TIER_INTERVAL_MS: Record<Exclude<BoardTier, "paused">, number> = {
  hot: Number(process.env.POLL_HOT_MS ?? 2 * MIN),
  warm: Number(process.env.POLL_WARM_MS ?? 5 * MIN),
  cold: Number(process.env.POLL_COLD_MS ?? 30 * MIN),
};

const RANK: Record<BoardTier, number> = { paused: 0, cold: 1, warm: 2, hot: 3 };

/** Tier rules from guide P4-2. A paused board stays paused until the api resumes it. */
export function computeTier(
  b: { tier: BoardTier; createdAt: number; lastViewedAt: number | null; lastChangedAt: number | null; situation: string | null },
  now: number,
): BoardTier {
  if (b.tier === "paused") return "paused";
  const viewedAgo = b.lastViewedAt === null ? Infinity : now - b.lastViewedAt;
  const changedAgo = b.lastChangedAt === null ? Infinity : now - b.lastChangedAt;
  const createdAgo = now - b.createdAt;
  if (b.situation === "resolved" && changedAgo > 48 * HOUR && createdAgo > 48 * HOUR) return "paused";
  if (viewedAgo > 7 * DAY && createdAgo > 7 * DAY) return "paused";
  if (viewedAgo <= 2 * MIN || changedAgo <= 30 * MIN || createdAgo <= 2 * HOUR) return "hot";
  if (viewedAgo <= DAY || changedAgo <= DAY) return "warm";
  return "cold";
}

const GRAPHS: Record<Exclude<JobKind, "cleanup">, { name: GraphName; fn: GraphFn }> = {
  build: { name: "build", fn: buildGraph },
  edit: { name: "edit", fn: editGraph },
  poll: { name: "update", fn: updateGraph },
  discover: { name: "discover", fn: discoverGraph },
};

/**
 * How often the discover job looks for new crises. It runs only when an admin turned discovery on in /admin
 * (app_settings.discover_enabled, off by default); DISCOVER_ENABLED=0 turns it off regardless.
 */
export const DISCOVER_INTERVAL_MS = Number(process.env.DISCOVER_INTERVAL_MS ?? 30 * MIN);
const TOPIC_UPKEEP_MS = Number(process.env.TOPIC_UPKEEP_MS ?? 5 * MIN);
const discoverEnvOn = () => !/^(0|off|false|no)$/i.test(process.env.DISCOVER_ENABLED ?? "");

const log = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, proc: "worker", ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function setBoardStatus(boardId: string, status: BoardStatus) {
  await setStatus(boardId, status);
  const b = await getBoard(boardId);
  publish(boardId, { type: "status", status, tier: b?.tier ?? "hot" });
}

async function boardEvent(boardId: string, kind: "error" | "info", message: string) {
  const ev = await addEvent(boardId, kind, message);
  publish(boardId, { type: "event", event: ev });
}

async function runCleanup() {
  const now = Date.now();
  const pruned = await pruneOldData(now);
  const steps = await pruneStepOutputs(30 * DAY, now);
  const jobs = await pruneJobs(30 * DAY, now);
  log("info", "cleanup done", { ...pruned, stepOutputs: steps, jobs });
}

/** Runs one claimed job to the end. Exported for tests. */
export async function executeJob(job: Job, signal: AbortSignal) {
  const t0 = Date.now();
  try {
    if (job.kind === "cleanup") await runCleanup();
    else await runGraph(GRAPHS[job.kind].name, job, GRAPHS[job.kind].fn, { signal });
    await complete(job.id);
    log("info", "job done", { jobId: job.id, kind: job.kind, boardId: job.boardId, ms: Date.now() - t0 });
  } catch (e) {
    if (signal.aborted) {
      await release(job.id).catch(() => {});
      log("warn", "job released on shutdown", { jobId: job.id, kind: job.kind, boardId: job.boardId });
      return;
    }
    const { willRetry } = await fail(job.id, errText(e));
    log("error", "job failed", { jobId: job.id, kind: job.kind, boardId: job.boardId, willRetry, error: errText(e), ms: Date.now() - t0 });
    if (willRetry || job.kind === "cleanup") return;
    try {
      const board = await getBoard(job.boardId);
      if (!board) return;
      if (job.kind === "build" && !board.spec) {
        await boardEvent(job.boardId, "error", `Build failed: ${errText(e)}`);
        await setBoardStatus(job.boardId, "error");
      } else {
        await boardEvent(job.boardId, "error", `${job.kind === "edit" ? "Edit" : job.kind === "build" ? "Rebuild" : "Update"} failed: ${errText(e)}`);
        await setBoardStatus(job.boardId, "live");
      }
    } catch (e2) {
      log("error", "could not mark board after failure", { boardId: job.boardId, error: errText(e2) });
    }
  }
}

/** One scheduling pass: tiers, due polls. Exported for tests. */
export async function scheduleOnce(now = Date.now()) {
  for (const b of await listLiveBoardsForTiering()) {
    const tier = computeTier(b, now);
    if (tier === b.tier) continue;
    if (tier === "paused") {
      await setSchedule(b.id, { tier, nextPollAt: null });
      const removed = await removeBoardMonitors(b.id);
      await boardEvent(b.id, "info", `Paused live updates after a quiet period${removed ? ` (${removed} monitors removed)` : ""}`).catch(() => {});
      publish(b.id, { type: "status", status: "live", tier });
    } else {
      // Moving to a faster tier polls soon instead of waiting out the slower interval.
      const faster = RANK[tier] > RANK[b.tier];
      await setSchedule(b.id, faster ? { tier, nextPollAt: now } : { tier });
      // Context.dev runs the board's monitors less often on cooler tiers. Never throws.
      await setBoardMonitorSchedule(b.id, tier);
    }
  }
  const due = await listDueBoards(now, 200);
  for (const b of due) {
    if (b.tier === "paused") continue;
    await enqueue("poll", b.id, { reason: "schedule" });
    await setSchedule(b.id, { nextPollAt: now + TIER_INTERVAL_MS[b.tier] });
  }
  return { due: due.length };
}

export async function maybeEnqueueCleanup(now = Date.now()) {
  const last = await lastJobCreatedAt("cleanup");
  if (last !== null && now - last < DAY) return false;
  await enqueue("cleanup", SYSTEM_BOARD, null, { maxAttempts: 1 });
  return true;
}

/**
 * Queues a discover run unless one is queued or running, or one was queued less than an interval ago (the timer also
 * fires at startup, so a restart does not start an extra run).
 */
export async function maybeEnqueueDiscover(now = Date.now()) {
  if (!discoverEnvOn()) return false;
  if (!(await discoverEnabled())) return false;
  if (await hasPendingJob(SYSTEM_BOARD, ["discover"])) return false;
  const last = await lastJobCreatedAt("discover");
  if (last !== null && now - last < DISCOVER_INTERVAL_MS - MIN) return false;
  await enqueue("discover", SYSTEM_BOARD, null, { maxAttempts: 1 });
  return true;
}

/**
 * Shared topic upkeep: paused system topics become archived, active ones are ranked again, and topics that fell out
 * of the monitored top lose their monitors (search and pages below MONITORED_TOPICS, pages below
 * PAGE_MONITORED_TOPICS). Monitors are created by the graphs, which ask monitorAllowance first.
 */
export async function topicUpkeepOnce(now = Date.now()) {
  const archived = await archivePausedTopics();
  await recomputeRanks(now);
  const ranked = await rankedTopicIds();
  const position = new Map(ranked.map((id, i) => [id, i]));
  const byBoard = new Map<string, Set<string>>();
  for (const m of await listMonitors()) {
    if (!position.has(m.boardId) || m.remoteStatus === "dead") continue;
    if (!byBoard.has(m.boardId)) byBoard.set(m.boardId, new Set());
    byBoard.get(m.boardId)!.add(m.kind);
  }
  let released = 0;
  for (const [boardId, kinds] of byBoard) {
    const allow = allowanceAt(position.get(boardId)!);
    if (!allow.search) released += await removeBoardMonitors(boardId);
    else if (!allow.page && kinds.has("page")) released += await removeBoardMonitors(boardId, { kind: "page" });
  }
  if (archived.length || released) log("info", "topic upkeep", { archived: archived.length, monitorsReleased: released, ranked: ranked.length });
  return { archived: archived.length, released, ranked: ranked.length };
}

export async function reclaimOnce(now = Date.now()) {
  const n = await reclaimStale(60_000, now);
  if (n) log("warn", "reclaimed stale jobs", { count: n });
  for (const b of await orphanedBuildingBoards(2 * MIN, now)) {
    await boardEvent(b.id, "error", "The build stopped and could not be resumed").catch(() => {});
    await setBoardStatus(b.id, b.hasSpec ? "live" : "error").catch(() => {});
  }
  return n;
}

type Pool = { name: string; kinds: JobKind[]; size: number };

export function startWorker() {
  setBusMode("remote");
  const workerId = `${hostname()}-${process.pid}`.slice(0, 64);
  const stop = new AbortController();
  const running = new Set<Promise<void>>();
  // Set at shutdown: slots stop claiming while running jobs get their grace period.
  let draining = false;
  const pools: Pool[] = [
    { name: "build", kinds: ["build", "edit"], size: Math.max(1, Number(process.env.BUILD_CONCURRENCY ?? 3)) },
    { name: "poll", kinds: ["poll", "discover", "cleanup"], size: Math.max(1, Number(process.env.POLL_CONCURRENCY ?? 4)) },
  ];

  const idle = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      stop.signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
    });

  async function slot(pool: Pool) {
    while (!stop.signal.aborted && !draining) {
      let job: Job | null = null;
      try {
        job = await claim(workerId, pool.kinds);
      } catch (e) {
        log("error", "claim failed", { pool: pool.name, error: errText(e) });
        await idle(5_000);
        continue;
      }
      if (!job) {
        await idle(750 + Math.random() * 500);
        continue;
      }
      if (draining) {
        // Claimed just as shutdown began: hand it back untouched.
        await release(job.id).catch(() => {});
        break;
      }
      const p = executeJob(job, stop.signal);
      running.add(p);
      await p.finally(() => running.delete(p));
    }
  }

  const loops: Promise<void>[] = pools.flatMap((p) => Array.from({ length: p.size }, () => slot(p)));

  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    let busy = false;
    const tick = async () => {
      if (busy || stop.signal.aborted) return;
      busy = true;
      try {
        await fn();
      } catch (e) {
        log("error", `${name} failed`, { error: errText(e) });
      } finally {
        busy = false;
      }
    };
    void tick();
    return setInterval(() => void tick(), ms);
  };

  const timers = [
    every(15_000, "scheduler", () => scheduleOnce()),
    every(20_000, "reclaim", () => reclaimOnce()),
    every(30_000, "heartbeat", () => writeWorkerHeartbeat(workerId)),
    every(HOUR, "cleanup enqueue", () => maybeEnqueueCleanup()),
    every(DISCOVER_INTERVAL_MS, "discover enqueue", () => maybeEnqueueDiscover()),
    every(TOPIC_UPKEEP_MS, "topic upkeep", () => topicUpkeepOnce()),
  ];

  log("info", "worker started", { workerId, pools: pools.map((p) => `${p.name}x${p.size}`).join(" ") });

  let stopping = false;
  async function shutdown(sig: string) {
    if (stopping) return;
    stopping = true;
    draining = true;
    log("info", "worker stopping", { signal: sig, running: running.size });
    for (const t of timers) clearInterval(t);
    // Claiming has stopped (draining); give running jobs up to 30s to finish their current steps.
    const drained = Promise.allSettled([...running]);
    const grace = new Promise((r) => setTimeout(r, Number(process.env.WORKER_GRACE_MS ?? 30_000)));
    await Promise.race([drained, grace]);
    stop.abort(new Error("worker shutting down"));
    await Promise.race([Promise.allSettled([...running, ...loops]), new Promise((r) => setTimeout(r, 5_000))]);
    await flushRemote().catch(() => {});
    await closePool();
    log("info", "worker stopped");
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (e) => log("error", "unhandled rejection", { error: errText(e) }));

  return { workerId, shutdown, stopSignal: stop.signal };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startWorker();
