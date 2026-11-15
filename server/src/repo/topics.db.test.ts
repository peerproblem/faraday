import { describe, expect, it } from "vitest";
import { all, one, run } from "../db/pool";
import { useTestDb } from "../test/db";
import { createBoard, saveMonitor, listMonitors, listTopics } from "./boards";
import { claim, enqueue } from "./jobs";
import {
  archivePausedTopics,
  countActiveTopics,
  countDiscoveredSince,
  lastDiscoverAt,
  matchableTopics,
  monitorAllowance,
  rankedTopicIds,
  reactivateTopic,
  recentlyRejected,
  recomputeRanks,
  recordCandidates,
  setTopicCategory,
  SKIPPED_PREFIX,
  type CandidateRecord,
} from "./topics";

process.env.FARADAY_MONITORS = "off";
const t = useTestDb("repo_topics");
const DAY = 86_400_000;

const cand = (over: Partial<CandidateRecord> = {}): CandidateRecord => ({
  runId: 1,
  fingerprint: "a".repeat(64),
  title: "Valencia floods",
  crisisType: "flood",
  locationName: "Valencia, Spain",
  entities: ["Valencia"],
  score: 0.7,
  decision: "rejected",
  boardId: null,
  reason: "not an ongoing crisis",
  evidence: [{ url: "https://e.example/1", title: "x", publisher: "E", publishedAt: null }],
  ...over,
});

async function topic(set: Record<string, string | number | null> = {}, origin: "system" | "user" = "system") {
  const { id } = await createBoard(`topic ${Math.random()}`, null, { origin, entities: ["Valencia"], locationName: "Valencia, Spain", discoveredAt: Date.now() });
  const cols = Object.keys(set);
  if (cols.length) await run(`UPDATE boards SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...Object.values(set), id]);
  return id;
}

describe.skipIf(!t.enabled)("repo/topics", () => {
  it("groups hazard subtypes while honoring an individual topic's category override", async () => {
    const finished = { spec_version: 2, status: "live", spec: JSON.stringify({ version: 2, widgets: [] }) };
    const flood = await topic({ ...finished, crisis_type: "flood" });
    const volcano = await topic({ ...finished, crisis_type: "other" });
    const conflict = await topic({ ...finished, crisis_type: "conflict" });
    const finance = await topic({ ...finished, crisis_type: "other", spec: JSON.stringify({ template: "finance" }) });
    expect(await setTopicCategory(volcano, "volcano")).toBe(true);
    expect(await setTopicCategory(volcano, "volcano")).toBe(true);
    const allNatural = async () => (await listTopics({ crisisType: "natural-disasters", limit: 100 })).map(({ id }) => id);
    expect(await allNatural()).toEqual(expect.arrayContaining([flood, volcano]));
    expect(await allNatural()).not.toContain(conflict);
    expect((await listTopics({ crisisType: "economy", limit: 100 })).map(({ id }) => id)).toContain(finance);
    await setTopicCategory(volcano, null);
    expect(await allNatural()).not.toContain(volcano);
  });

  it("records candidates and finds recent judged rejections, not skips", async () => {
    const now = Date.now();
    await recordCandidates(
      [
        cand(),
        cand({ fingerprint: "b".repeat(64), reason: `${SKIPPED_PREFIX}rejected in the last 24 hours` }),
        cand({ fingerprint: "c".repeat(64), decision: "created", reason: "new topic" }),
      ],
      now,
    );
    await recordCandidates([cand({ fingerprint: "d".repeat(64) })], now - 2 * DAY);
    const got = await recentlyRejected(["a", "b", "c", "d"].map((x) => x.repeat(64)), DAY, now);
    expect([...got]).toEqual(["a".repeat(64)]);
    const row = await one<{ entities: string; evidence: string; run_id: number }>(`SELECT entities, evidence, run_id FROM topic_candidates WHERE fingerprint = ?`, [
      "c".repeat(64),
    ]);
    expect(JSON.parse(row!.entities)).toEqual(["Valencia"]);
    expect(JSON.parse(row!.evidence)).toHaveLength(1);
  });

  it("lists active and recently archived system topics for matching, and counts them", async () => {
    const before = await countActiveTopics();
    const active = await topic({ crisis_type: "flood" });
    const archivedRecent = await topic({ topic_state: "archived", last_changed_at: Date.now() - 5 * DAY });
    const archivedOld = await topic({ topic_state: "archived", last_changed_at: Date.now() - 40 * DAY, updated_at: Date.now() - 40 * DAY });
    const user = await topic({}, "user");
    const ids = (await matchableTopics()).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([active, archivedRecent]));
    expect(ids).not.toContain(archivedOld);
    expect(ids).not.toContain(user);
    const row = (await matchableTopics()).find((r) => r.id === active)!;
    expect(row).toMatchObject({ crisisType: "flood", locationName: "Valencia, Spain", entities: ["Valencia"], topicState: "active" });
    expect(await countActiveTopics()).toBe(before + 1);
    // The three system topics count; the user board (also given discovered_at) does not.
    const since = Date.now() - 60_000;
    const discovered = await countDiscoveredSince(since);
    const systemMade = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boards WHERE origin = 'system' AND discovered_at >= ?`, [since]);
    expect(discovered).toBe(Number(systemMade!.n));
    expect(discovered).toBeGreaterThanOrEqual(3);
    const all = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boards WHERE discovered_at >= ?`, [since]);
    expect(Number(all!.n)).toBe(discovered + 1);
  });

  it("archives paused system topics and brings them back as warm", async () => {
    const paused = await topic({ tier: "paused" });
    const userPaused = await topic({ tier: "paused" }, "user");
    expect(await archivePausedTopics()).toContain(paused);
    const st = async (id: string) => one<{ topic_state: string | null; tier: string; next_poll_at: number | null; last_viewed_at: number | null }>(
      `SELECT topic_state, tier, next_poll_at, last_viewed_at FROM boards WHERE id = ?`,
      [id],
    );
    expect((await st(paused))!.topic_state).toBe("archived");
    expect((await st(userPaused))!.topic_state).toBeNull();
    const now = Date.now();
    expect(await reactivateTopic(paused, now)).toBe(true);
    expect(await st(paused)).toMatchObject({ topic_state: "active", tier: "warm" });
    expect(Number((await st(paused))!.next_poll_at)).toBe(now);
    expect(await reactivateTopic(paused, now)).toBe(false);
  });

  it("ranks by severity, recent change, outlets and views, and gives monitors to the top", async () => {
    await run(`UPDATE boards SET topic_state = 'archived' WHERE origin = 'system'`);
    const now = Date.now();
    const top = await topic({ severity: 5, last_changed_at: now, last_viewed_at: now });
    const mid = await topic({ severity: 3, last_changed_at: now - DAY });
    const low = await topic({ severity: 1 });
    await run(`INSERT INTO sources (board_id, id, url, publisher, kind, fetched_at, url_hash) VALUES (?, 's1', 'https://a', 'A', 'news', 0, 'h1'), (?, 's2', 'https://b', 'B', 'news', 0, 'h2')`, [low, low]);
    expect(await recomputeRanks(now)).toEqual([top, mid, low]);
    const ranks = await all<{ id: string; rank_score: number }>(`SELECT id, rank_score FROM boards WHERE id IN (?, ?, ?)`, [top, mid, low]);
    const r = Object.fromEntries(ranks.map((x) => [x.id, Number(x.rank_score)]));
    expect(r[top]).toBeCloseTo(0.4 + 0.3 + 0 + 0.1, 3);
    expect(r[low]).toBeCloseTo(0.4 * 0.2 + 0.2 * (2 / 20), 3);
    expect(await rankedTopicIds()).toEqual([top, mid, low]);

    process.env.MONITORED_TOPICS = "2";
    process.env.PAGE_MONITORED_TOPICS = "1";
    try {
      expect(await monitorAllowance(top)).toEqual({ search: true, page: true });
      expect(await monitorAllowance(mid)).toEqual({ search: true, page: false });
      expect(await monitorAllowance(low)).toEqual({ search: false, page: false });
      const user = await topic({}, "user");
      expect(await monitorAllowance(user)).toEqual({ search: true, page: true });
      await run(`UPDATE boards SET topic_state = 'archived' WHERE id = ?`, [low]);
      expect(await monitorAllowance(low)).toEqual({ search: false, page: false });
      await run(`UPDATE boards SET topic_state = 'active' WHERE id = ?`, [low]);

      // Upkeep releases what the ranking no longer allows.
      await saveMonitor({ id: "m-top-s", boardId: top, kind: "search", target: "q", webhookSecret: null });
      await saveMonitor({ id: "m-top-p", boardId: top, kind: "page", target: "https://top.gov", webhookSecret: null });
      await saveMonitor({ id: "m-mid-s", boardId: mid, kind: "search", target: "q", webhookSecret: null });
      await saveMonitor({ id: "m-mid-p", boardId: mid, kind: "page", target: "https://mid.gov", webhookSecret: null });
      await saveMonitor({ id: "m-low-s", boardId: low, kind: "search", target: "q", webhookSecret: null });
      await saveMonitor({ id: "m-user-p", boardId: user, kind: "page", target: "https://user.gov", webhookSecret: null });
      const { topicUpkeepOnce } = await import("../worker");
      const res = await topicUpkeepOnce(now);
      expect(res.released).toBe(2);
      expect((await listMonitors()).map((m) => m.id).sort()).toEqual(["m-mid-s", "m-top-p", "m-top-s", "m-user-p"]);
    } finally {
      delete process.env.MONITORED_TOPICS;
      delete process.env.PAGE_MONITORED_TOPICS;
    }
  });

  it("queues discover once per interval, and claims it without a board lock", async () => {
    const { maybeEnqueueDiscover, SYSTEM_BOARD, DISCOVER_INTERVAL_MS } = await import("../worker");
    const { setDiscoverEnabled } = await import("./settings");
    await run(`DELETE FROM jobs WHERE kind = 'discover'`);
    // Off by default (migration 008): nothing is queued until an admin turns discovery on.
    expect(await maybeEnqueueDiscover()).toBe(false);
    await setDiscoverEnabled(true);
    expect(await maybeEnqueueDiscover()).toBe(true);
    expect(await maybeEnqueueDiscover()).toBe(false);
    const job = await claim("w1", ["discover"]);
    expect(job).toMatchObject({ kind: "discover", boardId: SYSTEM_BOARD, status: "running", maxAttempts: 1 });
    await run(`UPDATE jobs SET status = 'done' WHERE id = ?`, [job!.id]);
    // Done, but queued less than an interval ago: not again yet.
    expect(await maybeEnqueueDiscover()).toBe(false);
    expect(await maybeEnqueueDiscover(Date.now() + DISCOVER_INTERVAL_MS)).toBe(true);
    process.env.DISCOVER_ENABLED = "0";
    try {
      await run(`DELETE FROM jobs WHERE kind = 'discover'`);
      expect(await maybeEnqueueDiscover()).toBe(false);
    } finally {
      delete process.env.DISCOVER_ENABLED;
      await setDiscoverEnabled(false);
    }
    await enqueue("discover", SYSTEM_BOARD, null, { maxAttempts: 1 });
  });

  it("reads the start of the last finished discover run", async () => {
    expect(await lastDiscoverAt()).toBeNull();
    await run(`INSERT INTO runs (board_id, job_id, graph, status, started_at) VALUES ('__system__', 1, 'discover', 'done', 1000), ('__system__', 2, 'discover', 'failed', 5000)`);
    expect(await lastDiscoverAt()).toBe(1000);
  });
});
