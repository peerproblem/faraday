// Personal views (a user's layout overlay on a topic), their revisions, topic requests, and the admin reads of
// discovery candidates. Pure data access.
import { all, json, one, run, tx, type Param } from "../db/pool";
import type {
  CandidateDecision,
  PersonalLayout,
  PersonalViewCard,
  TopicCandidateView,
  TopicRequestView,
} from "../spec";
import { cardCols, toCard } from "./boards";

/** Revisions kept per view, for undo. */
export const KEEP_REVISIONS = 20;

const num = (v: unknown) => Number(v);

export async function getView(userId: string, boardId: string): Promise<{ layout: PersonalLayout; rev: number } | null> {
  const r = await one<{ layout: string; rev: number }>(`SELECT layout, rev FROM personal_views WHERE user_id = ? AND board_id = ?`, [userId, boardId]);
  if (!r) return null;
  const layout = json<PersonalLayout>(r.layout);
  return layout ? { layout, rev: num(r.rev) } : null;
}

export async function countViews(userId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM personal_views WHERE user_id = ?`, [userId]);
  return num(r?.n ?? 0);
}

export type SaveOutcome = { ok: true; rev: number } | { ok: false; current: { layout: PersonalLayout; rev: number } | null };

const errno = (e: unknown) => (e as { errno?: number })?.errno;
const isDuplicate = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY" || errno(e) === 1062;
const isDeadlock = (e: unknown) => errno(e) === 1213;

/**
 * Saves a layout when `expectedRev` is the stored rev (0 when there is no view yet). On a mismatch nothing is written
 * and the stored view comes back. Each save writes a revision; only the last KEEP_REVISIONS are kept.
 */
export async function saveView(
  userId: string,
  boardId: string,
  layout: PersonalLayout,
  expectedRev: number,
  meta: { instruction?: string | null; reply?: string | null } = {},
  at = Date.now(),
): Promise<SaveOutcome> {
  const body = JSON.stringify(layout);
  const attempt = () =>
    tx(async (db): Promise<SaveOutcome> => {
      let rev: number;
      if (expectedRev === 0) {
        // First save: a plain insert. A concurrent first save waits on the key, then fails as a duplicate.
        rev = 1;
        await db.run(`INSERT INTO personal_views (user_id, board_id, layout, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [
          userId,
          boardId,
          body,
          rev,
          at,
          at,
        ]);
      } else {
        const cur = await db.one<{ layout: string; rev: number }>(
          `SELECT layout, rev FROM personal_views WHERE user_id = ? AND board_id = ? FOR UPDATE`,
          [userId, boardId],
        );
        const curRev = cur ? num(cur.rev) : 0;
        if (!cur || curRev !== expectedRev) {
          const l = cur ? json<PersonalLayout>(cur.layout) : null;
          return { ok: false, current: cur && l ? { layout: l, rev: curRev } : null };
        }
        rev = curRev + 1;
        await db.run(`UPDATE personal_views SET layout = ?, rev = ?, updated_at = ? WHERE user_id = ? AND board_id = ?`, [body, rev, at, userId, boardId]);
      }
      await db.run(
        `INSERT INTO personal_view_revisions (user_id, board_id, rev, layout, instruction, reply, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, boardId, rev, body, meta.instruction ?? null, meta.reply ?? null, at],
      );
      await db.run(`DELETE FROM personal_view_revisions WHERE user_id = ? AND board_id = ? AND rev <= ?`, [userId, boardId, rev - KEEP_REVISIONS]);
      return { ok: true, rev };
    });
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (e) {
      if (isDuplicate(e)) return { ok: false, current: await getView(userId, boardId) };
      if (isDeadlock(e) && tries < 2) continue;
      throw e;
    }
  }
}

/**
 * Goes back one step: the current revision is dropped and the one before it becomes current under a new, higher rev
 * (so clients holding the old rev get a 409 on their next save). Repeated undos walk back through the history.
 * Null when there is nothing before the current revision.
 */
export async function undoView(userId: string, boardId: string, at = Date.now()): Promise<{ layout: PersonalLayout; rev: number } | null> {
  return tx(async (db) => {
    const cur = await db.one<{ rev: number }>(`SELECT rev FROM personal_views WHERE user_id = ? AND board_id = ? FOR UPDATE`, [userId, boardId]);
    if (!cur) return null;
    const curRev = num(cur.rev);
    const prev = await db.one<{ rev: number; layout: string }>(
      `SELECT rev, layout FROM personal_view_revisions WHERE user_id = ? AND board_id = ? AND rev < ? ORDER BY rev DESC LIMIT 1`,
      [userId, boardId, curRev],
    );
    const layout = prev ? json<PersonalLayout>(prev.layout) : null;
    if (!prev || !layout) return null;
    const rev = curRev + 1;
    await db.run(`DELETE FROM personal_view_revisions WHERE user_id = ? AND board_id = ? AND rev >= ?`, [userId, boardId, curRev]);
    await db.run(`UPDATE personal_view_revisions SET rev = ? WHERE user_id = ? AND board_id = ? AND rev = ?`, [rev, userId, boardId, num(prev.rev)]);
    await db.run(`UPDATE personal_views SET layout = ?, rev = ?, updated_at = ? WHERE user_id = ? AND board_id = ?`, [prev.layout, rev, at, userId, boardId]);
    return { layout, rev };
  });
}

export async function deleteView(userId: string, boardId: string): Promise<void> {
  await tx(async (db) => {
    await db.run(`DELETE FROM personal_view_revisions WHERE user_id = ? AND board_id = ?`, [userId, boardId]);
    await db.run(`DELETE FROM personal_views WHERE user_id = ? AND board_id = ?`, [userId, boardId]);
  });
}

/** The user's views on boards that still exist, most recently saved first. */
export async function listViews(userId: string, limit = 50): Promise<PersonalViewCard[]> {
  type Row = Parameters<typeof toCard>[0] & { view_updated_at: number; last_changed_at: number | null };
  const rows = await all<Row>(
    `SELECT ${cardCols("b.")}, b.last_changed_at, v.updated_at AS view_updated_at
     FROM personal_views v JOIN boards b ON b.id = v.board_id
     WHERE v.user_id = ? AND b.deleted_at IS NULL
     ORDER BY v.updated_at DESC LIMIT ?`,
    [userId, Math.max(1, Math.min(100, Math.floor(limit)))],
  );
  return rows.map((r) => {
    const viewUpdatedAt = num(r.view_updated_at);
    const changed = r.last_changed_at === null || r.last_changed_at === undefined ? null : num(r.last_changed_at);
    return { ...toCard(r), viewUpdatedAt, changedSinceVisit: changed !== null && changed > viewUpdatedAt };
  });
}

export async function addTopicRequests(boardId: string, userId: string, texts: string[], at = Date.now()): Promise<void> {
  const clean = texts.map((t) => t.trim().slice(0, 500)).filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  await run(
    `INSERT INTO topic_requests (board_id, user_id, text, status, created_at) VALUES ${clean.map(() => "(?, ?, ?, 'open', ?)").join(", ")}`,
    clean.flatMap((t) => [boardId, userId, t, at]),
  );
}

export async function listTopicRequests(opts: { boardId?: string | null; status?: TopicRequestView["status"] | null; limit?: number }): Promise<TopicRequestView[]> {
  const where: string[] = [];
  const params: Param[] = [];
  if (opts.boardId) {
    where.push("board_id = ?");
    params.push(opts.boardId);
  }
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  }
  params.push(Math.max(1, Math.min(500, Math.floor(opts.limit ?? 200))));
  const rows = await all<{ id: number; board_id: string; user_id: string; text: string; status: string; created_at: number }>(
    `SELECT id, board_id, user_id, text, status, created_at FROM topic_requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    params,
  );
  return rows.map((r) => ({
    id: num(r.id),
    boardId: r.board_id,
    userId: r.user_id,
    text: r.text,
    status: r.status === "accepted" || r.status === "rejected" ? r.status : "open",
    createdAt: num(r.created_at),
  }));
}

const DECISIONS = new Set<CandidateDecision>(["created", "matched", "rejected", "deferred"]);

/** What the discover job saw and decided, newest first. */
export async function listCandidates(limit = 100): Promise<TopicCandidateView[]> {
  const rows = await all<{
    id: number;
    run_id: number;
    title: string;
    crisis_type: string;
    location_name: string | null;
    entities: string;
    score: number;
    decision: string;
    board_id: string | null;
    reason: string | null;
    evidence: string;
    created_at: number;
  }>(
    `SELECT id, run_id, title, crisis_type, location_name, entities, score, decision, board_id, reason, evidence, created_at
     FROM topic_candidates ORDER BY created_at DESC, id DESC LIMIT ?`,
    [Math.max(1, Math.min(500, Math.floor(limit)))],
  );
  const safe = <T>(v: string, d: T): T => {
    try {
      return json<T>(v) ?? d;
    } catch {
      return d;
    }
  };
  return rows.map((r) => ({
    id: num(r.id),
    runId: num(r.run_id),
    title: r.title,
    crisisType: r.crisis_type,
    locationName: r.location_name,
    entities: safe<unknown[]>(r.entities, []).filter((e): e is string => typeof e === "string"),
    score: Number(r.score),
    decision: DECISIONS.has(r.decision as CandidateDecision) ? (r.decision as CandidateDecision) : "deferred",
    boardId: r.board_id,
    reason: r.reason,
    evidence: safe<TopicCandidateView["evidence"]>(r.evidence, []),
    createdAt: num(r.created_at),
  }));
}
