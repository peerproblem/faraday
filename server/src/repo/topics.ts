// Shared topics (system boards): discovery candidates, matching lookups, ranking, archiving and monitor allowance.
// Pure data access plus the pure scoring functions the discover graph and the worker share.
import { createHash } from "node:crypto";
import { frozenBoard } from "../frozen-boards";
import { all, json, one, run, type Param } from "../db/pool";
import type { BoardCard, CandidateDecision, CrisisType, TopicCategory, TopicState } from "../spec";
import { cardCols, effectiveTopicCategory, toCard } from "./boards";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const envNum = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
};

/** Read at call time so tests and operators can change them without a restart of the module. */
export const TOPIC_LIMITS = {
  minScore: () => envNum("DISCOVER_MIN_SCORE", 0.35),
  newPerRun: () => envNum("MAX_NEW_TOPICS_PER_RUN", 3),
  newPerDay: () => envNum("MAX_NEW_TOPICS_PER_DAY", 10),
  maxActive: () => envNum("MAX_ACTIVE_TOPICS", 30),
  /** Top topics by rank that get a search monitor. */
  monitored: () => envNum("MONITORED_TOPICS", 5),
  /** Top topics by rank that also get page monitors. */
  pageMonitored: () => Math.min(envNum("PAGE_MONITORED_TOPICS", 2), envNum("MONITORED_TOPICS", 5)),
};

// ---------- scoring (pure) ----------

export const TYPE_BOOST: Record<CrisisType, number> = {
  earthquake: 1,
  flood: 1,
  wildfire: 1,
  conflict: 1,
  storm: 1,
  heatwave: 0.9,
  volcano: 1,
  "other-natural-disaster": 1,
  health: 0.9,
  industrial: 0.9,
  transport: 0.9,
  outage: 0.9,
  cyberattack: 0.9,
  other: 0.6,
};

/** Discovery score, 0 to 1 (spec 5.2). */
export function candidateScore(c: { crisisType: CrisisType; publishers: number; articles: number; newestAt: number | null }, now: number): number {
  const coverage = Math.min(1, c.publishers / 8);
  const recency = c.newestAt === null ? 0 : Math.exp(-Math.max(0, now - c.newestAt) / (12 * HOUR));
  const spread = Math.min(1, c.articles / 15);
  return (TYPE_BOOST[c.crisisType] ?? 0.6) * (0.5 * coverage + 0.3 * recency + 0.2 * spread);
}

/** Home ranking, 0 to 1 (spec 5.2). Viewer counts live in the api process, so recency of the last view stands in. */
export function topicRank(
  t: { severity: number | null; lastChangedAt: number | null; publishers: number; lastViewedAt: number | null },
  now: number,
): number {
  const severity = Math.min(5, Math.max(0, t.severity ?? 0)) / 5;
  const changed = t.lastChangedAt === null ? 0 : Math.exp(-Math.max(0, now - t.lastChangedAt) / DAY);
  const breadth = Math.min(1, t.publishers / 20);
  const viewed = t.lastViewedAt === null ? 0 : Math.exp(-Math.max(0, now - t.lastViewedAt) / HOUR);
  return 0.4 * severity + 0.3 * changed + 0.2 * breadth + 0.1 * viewed;
}

export const normName = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Identity of a candidate across runs: crisis type plus the place (or, without a place, its first entity).
 * Entity lists vary between model calls, so only the most stable part goes in.
 */
export function fingerprint(c: { crisisType: string; locationName: string | null; entities: string[] }): string {
  const place = normName(c.locationName) || normName(c.entities[0]) || "";
  return createHash("sha256").update(`${c.crisisType}|${place}`).digest("hex");
}

// ---------- candidates ----------

export type Evidence = { url: string; title: string; publisher: string | null; publishedAt: string | null };

export type CandidateRecord = {
  runId: number;
  fingerprint: string;
  title: string;
  crisisType: string;
  locationName: string | null;
  entities: string[];
  score: number;
  decision: CandidateDecision;
  boardId: string | null;
  reason: string | null;
  evidence: Evidence[];
};

/** Reasons that start with this were not judged in this run (a recent rejection was reused). */
export const SKIPPED_PREFIX = "skipped: ";

export async function recordCandidates(rows: CandidateRecord[], at = Date.now()): Promise<void> {
  if (!rows.length) return;
  const marks = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const params: Param[] = rows.flatMap((r) => [
    r.runId,
    r.fingerprint,
    r.title.slice(0, 500),
    r.crisisType.slice(0, 32),
    r.locationName?.slice(0, 255) ?? null,
    JSON.stringify(r.entities.slice(0, 20)),
    Number.isFinite(r.score) ? r.score : 0,
    r.decision,
    r.boardId,
    r.reason?.slice(0, 2000) ?? null,
    JSON.stringify(r.evidence.slice(0, 30)),
    at,
  ]);
  await run(
    `INSERT INTO topic_candidates (run_id, fingerprint, title, crisis_type, location_name, entities, score, decision, board_id, reason, evidence, created_at)
     VALUES ${marks}`,
    params,
  );
}

/** Fingerprints judged and rejected within the window (not ones that were only skipped because of an earlier rejection). */
export async function recentlyRejected(fingerprints: string[], withinMs = DAY, now = Date.now()): Promise<Set<string>> {
  if (!fingerprints.length) return new Set();
  const rows = await all<{ fingerprint: string }>(
    `SELECT DISTINCT fingerprint FROM topic_candidates
     WHERE decision = 'rejected' AND created_at >= ? AND (reason IS NULL OR reason NOT LIKE ?)
       AND fingerprint IN (${fingerprints.map(() => "?").join(", ")})`,
    [now - withinMs, `${SKIPPED_PREFIX}%`, ...fingerprints],
  );
  return new Set(rows.map((r) => r.fingerprint));
}

/** Start of the last discover run that finished, or null. */
export async function lastDiscoverAt(): Promise<number | null> {
  const r = await one<{ t: number | null }>(`SELECT MAX(started_at) AS t FROM runs WHERE graph = 'discover' AND status = 'done'`);
  return r?.t === null || r?.t === undefined ? null : Number(r.t);
}

// ---------- topics ----------

export type TopicRow = {
  id: string;
  title: string | null;
  crisisType: string | null;
  locationName: string | null;
  entities: string[];
  topicState: TopicState;
  headline: string | null;
};

/** Active system topics and ones archived in the last 30 days (by last change), for matching new candidates. */
export async function matchableTopics(now = Date.now(), archivedWithinMs = 30 * DAY): Promise<TopicRow[]> {
  const rows = await all<{
    id: string;
    title: string | null;
    prompt: string;
    crisis_type: string | null;
    location_name: string | null;
    entities: string | null;
    topic_state: string;
    headline: string | null;
  }>(
    `SELECT id, title, prompt, crisis_type, location_name, entities, topic_state, headline FROM boards
     WHERE deleted_at IS NULL AND origin = 'system' AND merged_into IS NULL
       AND (topic_state = 'active' OR (topic_state = 'archived' AND COALESCE(last_changed_at, updated_at) >= ?))`,
    [now - archivedWithinMs],
  );
  return rows.map((r) => {
    const ents = json<unknown>(r.entities);
    return {
      id: r.id,
      title: r.title ?? r.prompt.slice(0, 200),
      crisisType: r.crisis_type,
      locationName: r.location_name,
      entities: Array.isArray(ents) ? ents.filter((e): e is string => typeof e === "string") : [],
      topicState: r.topic_state === "archived" ? "archived" : "active",
      headline: r.headline,
    };
  });
}

export async function countActiveTopics(): Promise<number> {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boards WHERE deleted_at IS NULL AND origin = 'system' AND topic_state = 'active'`);
  return Number(r?.n ?? 0);
}

/** Topics the discover job made (discovered_at set) since the given time. Admin-made topics do not count. */
export async function countDiscoveredSince(since: number): Promise<number> {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boards WHERE origin = 'system' AND discovered_at >= ?`, [since]);
  return Number(r?.n ?? 0);
}

/**
 * An archived topic that matched a new candidate goes back to active and warm, polls now, and counts as just viewed
 * (otherwise the week-without-views rule would pause it again on the next scheduler pass).
 */
export async function reactivateTopic(id: string, now = Date.now()): Promise<boolean> {
  const r = await run(
    `UPDATE boards SET topic_state = 'active', tier = 'warm', next_poll_at = ?, last_viewed_at = ?
     WHERE id = ? AND origin = 'system' AND topic_state = 'archived' AND deleted_at IS NULL`,
    [now, now, id],
  );
  return Number(r.affectedRows) > 0;
}

/** System topics whose tier is paused become archived ("past issues"). Returns their ids. */
export async function archivePausedTopics(): Promise<string[]> {
  const rows = await all<{ id: string }>(
    `SELECT id FROM boards WHERE deleted_at IS NULL AND origin = 'system' AND topic_state = 'active' AND tier = 'paused'`,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  await run(`UPDATE boards SET topic_state = 'archived' WHERE id IN (${ids.map(() => "?").join(", ")}) AND topic_state = 'active'`, ids);
  return ids;
}

/** Recomputes rank_score for every active system topic. Returns ids best first. */
export async function recomputeRanks(now = Date.now()): Promise<string[]> {
  const rows = await all<{ id: string; severity: number | null; last_changed_at: number | null; last_viewed_at: number | null; publishers: number }>(
    `SELECT b.id, b.severity, b.last_changed_at, b.last_viewed_at,
       (SELECT COUNT(DISTINCT s.publisher) FROM sources s WHERE s.board_id = b.id AND s.discarded = 0 AND s.publisher IS NOT NULL) AS publishers
     FROM boards b WHERE b.deleted_at IS NULL AND b.origin = 'system' AND b.topic_state = 'active'`,
  );
  const scored = rows.map((r) => ({
    id: r.id,
    rank: topicRank(
      {
        severity: r.severity === null ? null : Number(r.severity),
        lastChangedAt: r.last_changed_at === null ? null : Number(r.last_changed_at),
        lastViewedAt: r.last_viewed_at === null ? null : Number(r.last_viewed_at),
        publishers: Number(r.publishers ?? 0),
      },
      now,
    ),
  }));
  for (const s of scored) await run(`UPDATE boards SET rank_score = ? WHERE id = ?`, [Math.round(s.rank * 1e6) / 1e6, s.id]);
  return scored.sort((a, b) => b.rank - a.rank).map((s) => s.id);
}

/** Active system topics, best ranked first (unscored last, newest first), the order monitor allowance follows. */
export async function rankedTopicIds(): Promise<string[]> {
  const rows = await all<{ id: string }>(
    `SELECT id FROM boards WHERE deleted_at IS NULL AND origin = 'system' AND topic_state = 'active'
     ORDER BY rank_score IS NULL, rank_score DESC, created_at DESC`,
  );
  return rows.map((r) => r.id);
}

export type MonitorAllowance = { search: boolean; page: boolean };

/** Pure: where a topic sits in the ranking decides which monitors it may hold (G7). */
export function allowanceAt(index: number, limits = { monitored: TOPIC_LIMITS.monitored(), page: TOPIC_LIMITS.pageMonitored() }): MonitorAllowance {
  if (index < 0) return { search: false, page: false };
  return { search: index < limits.monitored, page: index < limits.page };
}

/** A priority topic can keep a search monitor outside the ranked allocation. */
export function allowanceFor(boardId: string, index: number): MonitorAllowance {
  if (frozenBoard(boardId)) return { search: false, page: false };
  const ranked = allowanceAt(index);
  if (index < 0 || ranked.search) return ranked;
  const priority = process.env.FARADAY_PRIORITY_SEARCH_MONITOR_BOARD_IDS?.split(",")
    .some((id) => id.trim() === boardId);
  return { ...ranked, search: priority === true };
}

/**
 * Which monitors a board may hold. Legacy user boards keep the old rule (no limit here). A system topic gets a search
 * monitor in the top MONITORED_TOPICS or when configured as a priority. Page monitoring follows
 * PAGE_MONITORED_TOPICS. Archived and merged topics get neither.
 */
export async function monitorAllowance(boardId: string): Promise<MonitorAllowance> {
  const b = await one<{ origin: string; topic_state: string | null }>(`SELECT origin, topic_state FROM boards WHERE id = ?`, [boardId]);
  if (!b || b.origin !== "system") return { search: true, page: true };
  if (b.topic_state !== "active") return { search: false, page: false };
  return allowanceFor(boardId, (await rankedTopicIds()).indexOf(boardId));
}

// ---------- admin ----------

/** Every system topic that is not deleted (active, archived and merged), newest first, for /admin. */
export async function listAdminTopics(limit = 200): Promise<BoardCard[]> {
  const rows = await all<Parameters<typeof toCard>[0]>(
    `SELECT ${cardCols()}, topic_category, ${effectiveTopicCategory} AS effective_topic_category
     FROM boards WHERE deleted_at IS NULL AND origin = 'system' ORDER BY created_at DESC LIMIT ?`,
    [Math.max(1, Math.min(500, Math.floor(limit)))],
  );
  return rows.map(toCard);
}

/**
 * An admin sets a system topic active or archived. Restoring behaves like a discovery match on an archived topic
 * (tier warm, a poll now, last_viewed_at now so the 7-day rule does not pause it again at once). Archiving pauses it.
 * Returns false when the id is not a live system topic.
 */
export async function setTopicState(id: string, state: "active" | "archived", now = Date.now()): Promise<boolean> {
  // affectedRows counts changed rows only, so an archive of an archived topic would look like "not found".
  const found = await one<{ id: string }>(`SELECT id FROM boards WHERE id = ? AND origin = 'system' AND deleted_at IS NULL`, [id]);
  if (!found) return false;
  if (state === "active") {
    await run(
      `UPDATE boards SET topic_state = 'active', tier = 'warm', next_poll_at = ?, last_viewed_at = ?
       WHERE id = ? AND origin = 'system' AND deleted_at IS NULL`,
      [now, now, id],
    );
  } else {
    await run(
      `UPDATE boards SET topic_state = 'archived', tier = 'paused', next_poll_at = NULL
       WHERE id = ? AND origin = 'system' AND deleted_at IS NULL`,
      [id],
    );
  }
  return true;
}

export async function setTopicCategory(id: string, category: TopicCategory | null): Promise<boolean> {
  const topicById = "id = ? AND origin = 'system' AND deleted_at IS NULL";
  const result = await run(`UPDATE boards SET topic_category = ? WHERE ${topicById}`, [category, id]);
  return Number(result.affectedRows) > 0 || !!(await one<{ id: string }>(`SELECT id FROM boards WHERE ${topicById}`, [id]));
}
