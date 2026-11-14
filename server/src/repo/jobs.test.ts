import { describe, expect, it } from "vitest";
import { one, run } from "../db/pool";
import { useTestDb } from "../test/db";
import {
  claim,
  complete,
  enqueue,
  fail,
  hasPendingJob,
  orphanedBuildingBoards,
  queueStats,
  reclaimStale,
  release,
} from "./jobs";

const t = useTestDb("runtime_jobs");

let seq = 0;
async function board(status = "live") {
  const id = `b${Date.now().toString(36)}${seq++}`;
  const now = Date.now();
  await run(`INSERT INTO boards (id, slug, prompt, status, created_at, updated_at) VALUES (?, ?, 'p', ?, ?, ?)`, [id, id, status, now, now]);
  return id;
}
const lockOf = async (id: string) => (await one<{ r: number | null }>(`SELECT running_job_id AS r FROM boards WHERE id = ?`, [id]))?.r ?? null;
const jobRow = (id: number) => one<{ status: string; attempts: number; run_after: number; error: string | null }>(`SELECT * FROM jobs WHERE id = ?`, [id]);

describe.skipIf(!t.enabled)("jobs", () => {
  it("claims by priority and takes the board lock", async () => {
    const a = await board();
    const b = await board();
    const poll = await enqueue("poll", a, { reason: "schedule" });
    const build = await enqueue("build", b, {});
    const first = await claim("w1", ["build", "edit", "poll"]);
    expect(first?.id).toBe(build);
    expect(first?.status).toBe("running");
    expect(first?.attempts).toBe(1);
    expect(await lockOf(b)).toBe(build);
    const second = await claim("w1", ["build", "edit", "poll"]);
    expect(second?.id).toBe(poll);
    await complete(build);
    await complete(poll);
    expect(await lockOf(b)).toBeNull();
    expect((await jobRow(build))?.status).toBe("done");
  });

  it("only claims the given kinds and due jobs", async () => {
    const a = await board();
    const later = await enqueue("build", a, {}, { runAfter: Date.now() + 60_000 });
    expect(await claim("w1", ["poll"])).toBeNull();
    expect(await claim("w1", ["build"])).toBeNull();
    const now = Date.now() + 61_000;
    expect((await claim("w1", ["build"], now))?.id).toBe(later);
    await complete(later);
  });

  it("dedupes queued polls and pulls an earlier one forward", async () => {
    const a = await board();
    const first = await enqueue("poll", a, { reason: "schedule" }, { runAfter: Date.now() + 120_000 });
    const second = await enqueue("poll", a, { reason: "manual" });
    expect(second).toBe(first);
    const row = await jobRow(first);
    expect(Number(row?.run_after)).toBeLessThanOrEqual(Date.now());
    expect(await hasPendingJob(a, ["poll"])).toBe(true);
    const j = await claim("w1", ["poll"]);
    expect(j?.payload).toEqual({ reason: "manual" });
    await complete(first);
  });

  it("does not run two jobs of one board at once", async () => {
    const a = await board();
    const build = await enqueue("build", a, {});
    const poll = await enqueue("poll", a, {});
    const j1 = await claim("w1", ["build", "poll"]);
    expect(j1?.id).toBe(build);
    const j2 = await claim("w2", ["build", "poll"]);
    expect(j2).toBeNull();
    const pushed = await jobRow(poll);
    expect(pushed?.status).toBe("queued");
    expect(Number(pushed?.run_after)).toBeGreaterThan(Date.now());
    await complete(build);
    const j3 = await claim("w2", ["poll"], Date.now() + 6_000);
    expect(j3?.id).toBe(poll);
    await complete(poll);
  });

  it("retries with backoff, then fails, and always frees the lock", async () => {
    const a = await board();
    const id = await enqueue("build", a, {}, { maxAttempts: 2 });
    await claim("w1", ["build"]);
    const r1 = await fail(id, "boom");
    expect(r1.willRetry).toBe(true);
    expect(await lockOf(a)).toBeNull();
    const row = await jobRow(id);
    expect(row?.status).toBe("queued");
    expect(Number(row?.run_after)).toBeGreaterThanOrEqual(Date.now() + 9_000);
    await claim("w1", ["build"], Date.now() + 11_000);
    const r2 = await fail(id, "boom again");
    expect(r2.willRetry).toBe(false);
    expect((await jobRow(id))?.status).toBe("failed");
    expect(await lockOf(a)).toBeNull();
  });

  it("reclaims jobs with a stale heartbeat", async () => {
    const a = await board("planning");
    const id = await enqueue("build", a, {});
    const t0 = Date.now();
    await claim("w1", ["build"], t0);
    expect(await reclaimStale(60_000, t0 + 30_000)).toBe(0);
    expect(await reclaimStale(60_000, t0 + 61_000)).toBe(1);
    expect((await jobRow(id))?.status).toBe("queued");
    expect(await lockOf(a)).toBeNull();
    const again = await claim("w2", ["build"], t0 + 61_000);
    expect(again?.id).toBe(id);
    expect(again?.attempts).toBe(2);
    await release(id);
    const r = await jobRow(id);
    expect(r?.status).toBe("queued");
    expect(Number(r?.attempts)).toBe(1);
    await complete(id);
  });

  it("finds boards stuck in a pipeline status with no job", async () => {
    const a = await board("gathering");
    await run(`UPDATE boards SET updated_at = ? WHERE id = ?`, [Date.now() - 10 * 60_000, a]);
    const stuck = await orphanedBuildingBoards(2 * 60_000);
    expect(stuck.map((s) => s.id)).toContain(a);
    await enqueue("build", a, {});
    expect((await orphanedBuildingBoards(2 * 60_000)).map((s) => s.id)).not.toContain(a);
  });

  it("claims cleanup and discover jobs on the system board without a board lock", async () => {
    const id = await enqueue("discover", "__system__", null, { maxAttempts: 1 });
    const j = await claim("w1", ["discover"]);
    expect(j?.id).toBe(id);
    expect(j?.status).toBe("running");
    expect((await jobRow(id))?.status).toBe("running");
    await complete(id);
    expect((await jobRow(id))?.status).toBe("done");
    expect((await queueStats()).queued).toHaveProperty("discover");
  });

  it("reports queue stats", async () => {
    const s = await queueStats();
    expect(typeof s.running).toBe("number");
    expect(s.queued).toHaveProperty("build");
  });
});
