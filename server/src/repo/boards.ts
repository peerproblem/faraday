// OWNER: F-DB. Pure data access: no publishing, no network. Callers publish through bus.ts.
import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";
import { all, json, one, run, tx, type Param } from "../db/pool";
import type {
  BoardCard,
  BoardData,
  BoardEvent,
  BoardMessage,
  BoardSpecV2,
  BoardStatus,
  BoardTier,
  BoardView,
  Plan,
  Source,
  SourceType,
  Visibility,
} from "../spec";

export type FoundDoc = {
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  snippet: string | null;
  kind: "news" | "web" | "monitor";
};

export type BoardRow = {
  id: string;
  slug: string;
  ownerId: string | null;
  prompt: string;
  title: string | null;
  status: BoardStatus;
  tier: BoardTier;
  visibility: Visibility;
  plan: Plan | null;
  specVersion: number;
  spec: BoardSpecV2 | null;
  data: BoardData | null;
  version: number;
  language: string | null;
  lastPolledAt: number | null;
  nextPollAt: number | null;
  lastViewedAt: number | null;
  lastChangedAt: number | null;
  runningJobId: number | null;
  createdAt: number;
  updatedAt: number;
};

type DbBoard = {
  id: string;
  slug: string;
  owner_id: string | null;
  prompt: string;
  title: string | null;
  status: BoardStatus;
  tier: BoardTier;
  visibility: Visibility;
  plan: string | null;
  spec_version: number;
  spec: string | null;
  data: string | null;
  version: number;
  language: string | null;
  last_polled_at: number | null;
  next_poll_at: number | null;
  last_viewed_at: number | null;
  last_changed_at: number | null;
  running_job_id: number | null;
  created_at: number;
  updated_at: number;
};

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const BOARD_COLS = `id, slug, owner_id, prompt, title, status, tier, visibility, plan, spec_version, spec, data, version, language,
  last_polled_at, next_poll_at, last_viewed_at, last_changed_at, running_job_id, created_at, updated_at`;

export const urlKey = (url: string) => url.split("#")[0];
export const urlHash = (url: string) => createHash("sha256").update(urlKey(url)).digest("hex");

function slugify(prompt: string) {
  const base = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-")
    .slice(0, 48)
    .replace(/-$/, "");
  return `${base || "board"}-${newId().slice(0, 5)}`;
}

function toRow(r: DbBoard): BoardRow {
  const v2 = Number(r.spec_version) >= 2;
  return {
    id: r.id,
    slug: r.slug,
    ownerId: r.owner_id,
    prompt: r.prompt,
    title: r.title,
    status: r.status,
    tier: r.tier,
    visibility: r.visibility,
    plan: v2 ? json<Plan>(r.plan) : null,
    specVersion: Number(r.spec_version),
    spec: v2 ? json<BoardSpecV2>(r.spec) : null,
    data: v2 ? json<BoardData>(r.data) : null,
    version: Number(r.version),
    language: r.language,
    lastPolledAt: num(r.last_polled_at),
    nextPollAt: num(r.next_poll_at),
    lastViewedAt: num(r.last_viewed_at),
    lastChangedAt: num(r.last_changed_at),
    runningJobId: num(r.running_job_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function createBoard(prompt: string, ownerId: string | null): Promise<{ id: string; slug: string }> {
  const id = newId();
  const slug = slugify(prompt);
  const now = Date.now();
  await tx(async (db) => {
    await db.run(
      `INSERT INTO boards (id, slug, owner_id, prompt, status, spec_version, tier, visibility, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 2, 'hot', 'public', 0, ?, ?)`,
      [id, slug, ownerId, prompt, now, now],
    );
    await db.run(`INSERT INTO messages (board_id, role, content, ts) VALUES (?, 'user', ?, ?)`, [id, prompt, now]);
  });
  return { id, slug };
}

export async function getBoard(id: string): Promise<BoardRow | null> {
  const r = await one<DbBoard>(`SELECT ${BOARD_COLS} FROM boards WHERE id = ? AND deleted_at IS NULL`, [id]);
  return r ? toRow(r) : null;
}

export async function boardIdForSlug(slug: string): Promise<string | null> {
  const r = await one<{ id: string }>(`SELECT id FROM boards WHERE slug = ? AND deleted_at IS NULL`, [slug]);
  return r?.id ?? null;
}

/** Sources (not discarded), last 200 events, messages. */
export async function getBoardView(id: string): Promise<BoardView | null> {
  const b = await getBoard(id);
  if (!b) return null;
  const [sources, events, messages] = await Promise.all([listSources(id), listEvents(id, { limit: 200 }), listMessages(id)]);
  return {
    id: b.id,
    slug: b.slug,
    prompt: b.prompt,
    title: b.title,
    status: b.status,
    tier: b.tier,
    visibility: b.visibility,
    specVersion: b.specVersion,
    spec: b.spec,
    data: b.data,
    version: b.version,
    sources,
    events,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    lastPolledAt: b.lastPolledAt,
    ownerId: b.ownerId,
    plan: b.plan,
    messages,
    language: b.language,
  };
}

/** Reads only list columns, never spec/data/plan. */
export async function listBoards(opts: { limit: number; ownerId?: string; publicOnly?: boolean }): Promise<BoardCard[]> {
  const where = ["deleted_at IS NULL"];
  const params: Param[] = [];
  if (opts.ownerId) {
    where.push("owner_id = ?");
    params.push(opts.ownerId);
  }
  if (opts.publicOnly) where.push("visibility = 'public'");
  params.push(Math.max(1, Math.min(200, Math.floor(opts.limit))));
  const rows = await all<{
    id: string;
    slug: string;
    title: string | null;
    prompt: string;
    status: BoardStatus;
    tier: BoardTier;
    updated_at: number;
    crisis_type: string | null;
    severity: number | null;
    headline: string | null;
    accent: string | null;
  }>(
    `SELECT id, slug, title, prompt, status, tier, updated_at, crisis_type, severity, headline, accent
     FROM boards WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    prompt: r.prompt,
    status: r.status,
    tier: r.tier,
    updatedAt: Number(r.updated_at),
    crisisType: r.crisis_type,
    severity: num(r.severity),
    headline: r.headline,
    accent: r.accent,
  }));
}

export async function setStatus(id: string, status: BoardStatus): Promise<void> {
  await run(`UPDATE boards SET status = ?, updated_at = ? WHERE id = ?`, [status, Date.now(), id]);
}

export async function savePlan(id: string, plan: Plan): Promise<void> {
  await run(`UPDATE boards SET plan = ?, title = ?, language = ?, crisis_type = ?, updated_at = ? WHERE id = ?`, [
    JSON.stringify(plan),
    plan.title.slice(0, 500),
    plan.language?.slice(0, 16) ?? null,
    plan.crisisType,
    Date.now(),
    id,
  ]);
}

const KEEP_VERSIONS = 50;

/**
 * Writes spec, data, spec_version = 2, the list columns (crisis_type, severity, headline, accent, title, language),
 * bumps version, inserts board_versions (keeps the latest 50), optionally sets status. Returns the new version.
 */
export async function saveBoardVersion(
  id: string,
  v: { spec: BoardSpecV2; data: BoardData; changeNote: string | null; status?: BoardStatus },
): Promise<number> {
  const h = v.data.header;
  const now = Date.now();
  return tx(async (db) => {
    await db.run(
      `UPDATE boards SET spec = ?, data = ?, spec_version = 2, title = ?, language = ?, crisis_type = ?, severity = ?,
         headline = ?, accent = ?, situation = ?, version = version + 1, updated_at = ?, status = COALESCE(?, status)
       WHERE id = ?`,
      [
        JSON.stringify(v.spec),
        JSON.stringify(v.data),
        h.title.slice(0, 500),
        h.language?.slice(0, 16) ?? null,
        h.crisisType,
        h.severity,
        h.headline?.text ?? null,
        h.accent,
        h.status,
        now,
        v.status ?? null,
        id,
      ],
    );
    const r = await db.one<{ version: number }>(`SELECT version FROM boards WHERE id = ? FOR UPDATE`, [id]);
    if (!r) throw new Error(`board ${id} not found`);
    const version = Number(r.version);
    await db.run(
      `INSERT INTO board_versions (board_id, version, spec, data, change_note, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE spec = VALUES(spec), data = VALUES(data), change_note = VALUES(change_note)`,
      [id, version, JSON.stringify(v.spec), JSON.stringify(v.data), v.changeNote, now],
    );
    await db.run(`DELETE FROM board_versions WHERE board_id = ? AND version <= ?`, [id, version - KEEP_VERSIONS]);
    return version;
  });
}

export async function markPolled(id: string, at = Date.now()): Promise<void> {
  await run(`UPDATE boards SET last_polled_at = ? WHERE id = ?`, [at, id]);
}

export async function markChanged(id: string, at = Date.now()): Promise<void> {
  await run(`UPDATE boards SET last_changed_at = ? WHERE id = ?`, [at, id]);
}

/** Rate-limited by the caller. */
export async function touchViewed(id: string, at = Date.now()): Promise<void> {
  await run(`UPDATE boards SET last_viewed_at = ? WHERE id = ?`, [at, id]);
}

export async function setSchedule(id: string, s: { tier?: BoardTier; nextPollAt?: number | null }): Promise<void> {
  const sets: string[] = [];
  const params: Param[] = [];
  if (s.tier !== undefined) {
    sets.push("tier = ?");
    params.push(s.tier);
  }
  if (s.nextPollAt !== undefined) {
    sets.push("next_poll_at = ?");
    params.push(s.nextPollAt);
  }
  if (!sets.length) return;
  await run(`UPDATE boards SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
}

/** Live boards whose next_poll_at has passed (or is null), not paused, oldest first. */
export async function listDueBoards(now: number, limit: number): Promise<{ id: string; tier: BoardTier }[]> {
  const rows = await all<{ id: string; tier: BoardTier }>(
    `SELECT id, tier FROM boards
     WHERE deleted_at IS NULL AND status = 'live' AND spec_version = 2 AND tier <> 'paused'
       AND (next_poll_at IS NULL OR next_poll_at <= ?)
     ORDER BY COALESCE(next_poll_at, 0), id LIMIT ?`,
    [now, Math.max(1, Math.floor(limit))],
  );
  return rows.map((r) => ({ id: r.id, tier: r.tier }));
}

/** Everything the scheduler needs to recompute tiers for live boards (paused ones included). */
export async function listLiveBoardsForTiering(): Promise<
  { id: string; tier: BoardTier; createdAt: number; lastViewedAt: number | null; lastChangedAt: number | null; situation: string | null }[]
> {
  const rows = await all<{
    id: string;
    tier: BoardTier;
    created_at: number;
    last_viewed_at: number | null;
    last_changed_at: number | null;
    situation: string | null;
  }>(
    `SELECT id, tier, created_at, last_viewed_at, last_changed_at, situation FROM boards
     WHERE deleted_at IS NULL AND status = 'live' AND spec_version = 2`,
  );
  return rows.map((r) => ({
    id: r.id,
    tier: r.tier,
    createdAt: Number(r.created_at),
    lastViewedAt: num(r.last_viewed_at),
    lastChangedAt: num(r.last_changed_at),
    situation: r.situation,
  }));
}

export async function setVisibility(id: string, visibility: Visibility): Promise<void> {
  await run(`UPDATE boards SET visibility = ?, updated_at = ? WHERE id = ?`, [visibility, Date.now(), id]);
}

/** Soft delete. Every read in this module ignores deleted boards. Monitors are removed by the caller. */
export async function deleteBoard(id: string): Promise<void> {
  await run(`UPDATE boards SET deleted_at = ?, tier = 'paused', next_poll_at = NULL WHERE id = ? AND deleted_at IS NULL`, [Date.now(), id]);
}

export async function listV1BoardIds(): Promise<string[]> {
  return (await all<{ id: string }>(`SELECT id FROM boards WHERE spec_version < 2 AND deleted_at IS NULL ORDER BY created_at`)).map(
    (r) => r.id,
  );
}

// sources

type SourceRow = {
  id: string;
  url: string;
  title: string | null;
  publisher: string | null;
  kind: Source["kind"];
  published_at: string | null;
  fetched_at: number;
  snippet: string | null;
  relevance: number | null;
  source_type: SourceType | null;
};

const toSource = (r: SourceRow): Source => ({
  id: r.id,
  url: r.url,
  title: r.title,
  publisher: r.publisher,
  kind: r.kind,
  publishedAt: r.published_at,
  fetchedAt: Number(r.fetched_at),
  snippet: r.snippet,
  relevance: num(r.relevance),
  sourceType: r.source_type,
});

const SOURCE_COLS = `id, url, title, publisher, kind, published_at, fetched_at, snippet, relevance, source_type`;

export async function listSources(boardId: string, opts?: { includeDiscarded?: boolean }): Promise<Source[]> {
  const rows = await all<SourceRow>(
    `SELECT ${SOURCE_COLS} FROM sources WHERE board_id = ? ${opts?.includeDiscarded ? "" : "AND discarded = 0"}
     ORDER BY CAST(SUBSTRING(id, 2) AS UNSIGNED)`,
    [boardId],
  );
  return rows.map(toSource);
}

/** Dedupes by url_hash (url without fragment). Returns only the newly added sources, ids continue s1, s2... */
export async function addSources(boardId: string, docs: FoundDoc[]): Promise<Source[]> {
  if (!docs.length) return [];
  return tx(async (db) => {
    // Serialises id allocation per board.
    await db.one(`SELECT id FROM boards WHERE id = ? FOR UPDATE`, [boardId]);
    const existing = new Set(
      (await db.all<{ url_hash: string }>(`SELECT url_hash FROM sources WHERE board_id = ?`, [boardId])).map((r) => r.url_hash),
    );
    const max = await db.one<{ n: number }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(id, 2) AS UNSIGNED)), 0) AS n FROM sources WHERE board_id = ?`,
      [boardId],
    );
    let n = Number(max?.n ?? 0);
    const now = Date.now();
    const added: (Source & { hash: string })[] = [];
    for (const doc of docs) {
      const url = urlKey(doc.url ?? "").trim();
      if (!url) continue;
      const hash = urlHash(url);
      if (existing.has(hash)) continue;
      existing.add(hash);
      n += 1;
      added.push({
        id: `s${n}`,
        url,
        title: doc.title,
        publisher: doc.publisher?.slice(0, 255) ?? null,
        kind: doc.kind,
        publishedAt: doc.publishedAt?.slice(0, 64) ?? null,
        fetchedAt: now,
        snippet: doc.snippet,
        relevance: null,
        sourceType: null,
        hash,
      });
    }
    if (added.length) {
      const placeholders = added.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", ");
      await db.run(
        `INSERT INTO sources (board_id, id, url, title, publisher, kind, published_at, fetched_at, snippet, url_hash) VALUES ${placeholders}`,
        added.flatMap((s) => [boardId, s.id, s.url, s.title, s.publisher, s.kind, s.publishedAt, s.fetchedAt, s.snippet, s.hash]),
      );
    }
    return added.map(({ hash: _hash, ...s }) => s);
  });
}

export async function discardSources(boardId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await run(`UPDATE sources SET discarded = 1 WHERE board_id = ? AND id IN (${ids.map(() => "?").join(", ")})`, [boardId, ...ids]);
}

export async function setSourceTriage(boardId: string, rows: { id: string; relevance: number; sourceType: SourceType }[]): Promise<void> {
  if (!rows.length) return;
  await tx(async (db) => {
    for (const r of rows) {
      await db.run(`UPDATE sources SET relevance = ?, source_type = ? WHERE board_id = ? AND id = ?`, [r.relevance, r.sourceType, boardId, r.id]);
    }
  });
}

export async function markExtracted(boardId: string, ids: string[], at = Date.now()): Promise<void> {
  if (!ids.length) return;
  await run(`UPDATE sources SET extracted_at = ? WHERE board_id = ? AND id IN (${ids.map(() => "?").join(", ")})`, [at, boardId, ...ids]);
}

export async function saveSourceText(boardId: string, sourceId: string, markdown: string): Promise<void> {
  await run(
    `INSERT INTO source_texts (board_id, source_id, markdown, fetched_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE markdown = VALUES(markdown), fetched_at = VALUES(fetched_at)`,
    [boardId, sourceId, markdown, Date.now()],
  );
}

export async function getSourceTexts(boardId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await all<{ source_id: string; markdown: string }>(
    `SELECT source_id, markdown FROM source_texts WHERE board_id = ? AND source_id IN (${ids.map(() => "?").join(", ")})`,
    [boardId, ...ids],
  );
  for (const r of rows) out.set(r.source_id, r.markdown);
  return out;
}

// events and messages

export async function addEvent(
  boardId: string,
  kind: BoardEvent["kind"],
  message: string,
  data: Record<string, unknown> | null = null,
): Promise<BoardEvent> {
  const ts = Date.now();
  const res = await run(`INSERT INTO events (board_id, ts, kind, message, data) VALUES (?, ?, ?, ?, ?)`, [
    boardId,
    ts,
    kind,
    message,
    data ? JSON.stringify(data) : null,
  ]);
  return { id: Number(res.insertId), ts, kind, message, data };
}

/**
 * Without afterId: the newest `limit` events, newest first.
 * With afterId: events after that id, oldest first (for SSE Last-Event-ID replay).
 */
export async function listEvents(boardId: string, opts?: { limit?: number; afterId?: number }): Promise<BoardEvent[]> {
  const limit = Math.max(1, Math.min(1000, Math.floor(opts?.limit ?? 100)));
  const rows =
    opts?.afterId !== undefined
      ? await all<{ id: number; ts: number; kind: BoardEvent["kind"]; message: string; data: string | null }>(
          `SELECT id, ts, kind, message, data FROM events WHERE board_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
          [boardId, opts.afterId, limit],
        )
      : await all<{ id: number; ts: number; kind: BoardEvent["kind"]; message: string; data: string | null }>(
          `SELECT id, ts, kind, message, data FROM events WHERE board_id = ? ORDER BY id DESC LIMIT ?`,
          [boardId, limit],
        );
  return rows.map((r) => ({ id: Number(r.id), ts: Number(r.ts), kind: r.kind, message: r.message, data: json(r.data) }));
}

export async function addMessage(boardId: string, role: "user" | "assistant", content: string): Promise<void> {
  await run(`INSERT INTO messages (board_id, role, content, ts) VALUES (?, ?, ?, ?)`, [boardId, role, content, Date.now()]);
}

export async function listMessages(boardId: string): Promise<BoardMessage[]> {
  const rows = await all<{ role: "user" | "assistant"; content: string; ts: number }>(
    `SELECT role, content, ts FROM messages WHERE board_id = ? ORDER BY id`,
    [boardId],
  );
  return rows.map((r) => ({ role: r.role, content: r.content, ts: Number(r.ts) }));
}

// monitors

export type MonitorRow = {
  id: string;
  boardId: string;
  kind: "search" | "page";
  target: string;
  lastSeenChangeAt: string | null;
  webhookSecret: string | null;
};

type DbMonitor = {
  id: string;
  board_id: string;
  kind: "search" | "page";
  target: string | null;
  query: string | null;
  last_seen_change_at: string | null;
  webhook_secret: string | null;
};

const toMonitor = (r: DbMonitor): MonitorRow => ({
  id: r.id,
  boardId: r.board_id,
  kind: r.kind,
  target: r.target ?? r.query ?? "",
  lastSeenChangeAt: r.last_seen_change_at,
  webhookSecret: r.webhook_secret,
});

export async function saveMonitor(m: Omit<MonitorRow, "lastSeenChangeAt">): Promise<void> {
  await run(
    `INSERT INTO monitors (id, board_id, kind, query, target, webhook_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE board_id = VALUES(board_id), kind = VALUES(kind), query = VALUES(query), target = VALUES(target),
       webhook_secret = VALUES(webhook_secret)`,
    [m.id, m.boardId, m.kind, m.target, m.target, m.webhookSecret, Date.now()],
  );
}

const MONITOR_COLS = `id, board_id, kind, target, query, last_seen_change_at, webhook_secret`;

export async function listMonitors(boardId?: string): Promise<MonitorRow[]> {
  const rows = boardId
    ? await all<DbMonitor>(`SELECT ${MONITOR_COLS} FROM monitors WHERE board_id = ? ORDER BY created_at`, [boardId])
    : await all<DbMonitor>(`SELECT ${MONITOR_COLS} FROM monitors ORDER BY created_at`);
  return rows.map(toMonitor);
}

export async function monitorById(id: string): Promise<MonitorRow | undefined> {
  const r = await one<DbMonitor>(`SELECT ${MONITOR_COLS} FROM monitors WHERE id = ?`, [id]);
  return r ? toMonitor(r) : undefined;
}

export async function setMonitorSeen(id: string, at: string): Promise<void> {
  await run(`UPDATE monitors SET last_seen_change_at = ? WHERE id = ?`, [at, id]);
}

export async function deleteMonitorRow(id: string): Promise<void> {
  await run(`DELETE FROM monitors WHERE id = ?`, [id]);
}

// limits

/** Counts deleted boards too, so deleting does not reset the hourly allowance. */
export async function countRecentBoards(ownerId: string, sinceMs: number): Promise<number> {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boards WHERE owner_id = ? AND created_at >= ?`, [ownerId, sinceMs]);
  return Number(r?.n ?? 0);
}

/** Boards of this owner that are not paused. */
export async function countActiveBoards(ownerId: string): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM boards WHERE owner_id = ? AND deleted_at IS NULL AND tier <> 'paused'`,
    [ownerId],
  );
  return Number(r?.n ?? 0);
}

/** For Caddy on-demand TLS: true when the slug exists and the board is not deleted. */
export async function slugExists(slug: string): Promise<boolean> {
  return (await boardIdForSlug(slug)) !== null;
}

// maintenance (called by the cleanup job)

const DAY = 86_400_000;
const KEEP_EVENTS = 500;

async function deleteInChunks(sql: (marks: string) => string, ids: number[], lead: Param[] = []) {
  let n = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    n += (await run(sql(chunk.map(() => "?").join(", ")), [...lead, ...chunk])).affectedRows;
  }
  return n;
}

export async function pruneOldData(now: number): Promise<{ events: number; versions: number; texts: number }> {
  const oldEvents = await all<{ id: number }>(
    `SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY id DESC) AS rn FROM events) x WHERE rn > ?`,
    [KEEP_EVENTS],
  );
  const events = await deleteInChunks((m) => `DELETE FROM events WHERE id IN (${m})`, oldEvents.map((r) => Number(r.id)));

  const oldVersions = await all<{ board_id: string; version: number }>(
    `SELECT board_id, version FROM (
       SELECT board_id, version, ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY version DESC) AS rn FROM board_versions
     ) x WHERE rn > ?`,
    [KEEP_VERSIONS],
  );
  let versions = 0;
  for (const v of oldVersions) {
    versions += (await run(`DELETE FROM board_versions WHERE board_id = ? AND version = ?`, [v.board_id, v.version])).affectedRows;
  }

  // Paused boards have had no views or changes for at least 7 days before pausing; 30 more days paused.
  const texts = (
    await run(
      `DELETE t FROM source_texts t JOIN boards b ON b.id = t.board_id
       WHERE (b.tier = 'paused' AND GREATEST(COALESCE(b.last_viewed_at, 0), COALESCE(b.last_changed_at, 0), b.created_at) < ?)
          OR (b.deleted_at IS NOT NULL AND b.deleted_at < ?)`,
      [now - 37 * DAY, now - 30 * DAY],
    )
  ).affectedRows;

  await run(`UPDATE run_steps SET output = NULL WHERE started_at < ? AND output IS NOT NULL`, [now - 30 * DAY]);
  return { events, versions, texts };
}
