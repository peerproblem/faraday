import { customAlphabet } from "nanoid";
import { all, json, one, run } from "./db";
import { publish } from "./bus";
import type { FoundDoc } from "./contextdev";
import type { BoardEvent, BoardMetrics, BoardSpec, BoardStatus, BoardView, Source } from "./spec";
import type { Plan } from "./harness/plan";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

type BoardRow = {
  id: string;
  slug: string;
  owner_id: string | null;
  prompt: string;
  title: string | null;
  status: BoardStatus;
  plan: string | null;
  spec: string | null;
  version: number;
  metrics: string | null;
  last_polled_at: number | null;
  created_at: number;
  updated_at: number;
};

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


export async function createBoard(prompt: string, ownerId: string | null) {
  const id = newId();
  const slug = slugify(prompt);
  const now = Date.now();
  await run(
    `INSERT INTO boards (id, slug, owner_id, prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    [id, slug, ownerId, prompt, now, now],
  );
  await addMessage(id, "user", prompt);
  return { id, slug };
}

function row(id: string) {
  return one<BoardRow>(`SELECT * FROM boards WHERE id = ?`, [id]);
}

export async function getRow(id: string) {
  const r = await row(id);
  if (!r) return null;
  return { ...r, plan: json<Plan>(r.plan), spec: json<BoardSpec>(r.spec), metrics: json<BoardMetrics>(r.metrics) };
}

export async function boardIdForSlug(slug: string): Promise<string | null> {
  const r = await one<{ id: string }>(`SELECT id FROM boards WHERE slug = ?`, [slug]);
  return r?.id ?? null;
}

export async function getBoardView(id: string): Promise<BoardView | null> {
  const r = await row(id);
  if (!r) return null;
  const [sources, events, messages] = await Promise.all([listSources(id), listEvents(id, 200), listMessages(id)]);
  return {
    id: r.id,
    slug: r.slug,
    prompt: r.prompt,
    title: r.title,
    status: r.status,
    spec: json<BoardSpec>(r.spec),
    version: r.version,
    metrics: json<BoardMetrics>(r.metrics),
    sources,
    events,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastPolledAt: r.last_polled_at,
    ownerId: r.owner_id,
    plan: json<Record<string, unknown>>(r.plan),
    messages,
  };
}

export type BoardCard = {
  id: string;
  slug: string;
  title: string | null;
  prompt: string;
  status: BoardStatus;
  updatedAt: number;
  crisisType: string | null;
  severity: number | null;
  headline: string | null;
  accent: string | null;
};

export async function listBoards(limit = 24, ownerId?: string): Promise<BoardCard[]> {
  const rows = ownerId
    ? await all<BoardRow>(`SELECT * FROM boards WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?`, [ownerId, limit])
    : await all<BoardRow>(`SELECT * FROM boards ORDER BY updated_at DESC LIMIT ?`, [limit]);
  return rows.map((r) => {
    const spec = json<BoardSpec>(r.spec);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      prompt: r.prompt,
      status: r.status,
      updatedAt: r.updated_at,
      crisisType: spec?.crisisType ?? null,
      severity: spec?.severity ?? null,
      headline: spec?.headline ?? null,
      accent: spec?.accent ?? null,
    };
  });
}

export async function liveBoardIds(): Promise<string[]> {
  return (await all<{ id: string }>(`SELECT id FROM boards WHERE status = 'live'`)).map((r) => r.id);
}

export async function setStatus(id: string, status: BoardStatus) {
  await run(`UPDATE boards SET status = ?, updated_at = ? WHERE id = ?`, [status, Date.now(), id]);
  const r = await row(id);
  publish({ type: "board", boardId: id, version: r?.version ?? 0, status });
}

export async function savePlan(id: string, plan: Plan) {
  await run(`UPDATE boards SET plan = ?, title = ?, updated_at = ? WHERE id = ?`, [
    JSON.stringify(plan),
    plan.title,
    Date.now(),
    id,
  ]);
}

export async function saveSpec(id: string, spec: BoardSpec, status?: BoardStatus) {
  await run(
    `UPDATE boards SET spec = ?, title = ?, version = version + 1, updated_at = ?, status = COALESCE(?, status) WHERE id = ?`,
    [JSON.stringify(spec), spec.title, Date.now(), status ?? null, id],
  );
  const r = (await row(id))!;
  publish({ type: "board", boardId: id, version: r.version, status: r.status });
  return r.version;
}

export async function saveMetrics(id: string, metrics: BoardMetrics) {
  await run(`UPDATE boards SET metrics = ? WHERE id = ?`, [JSON.stringify(metrics), id]);
}

export async function markPolled(id: string, at = Date.now()) {
  await run(`UPDATE boards SET last_polled_at = ? WHERE id = ?`, [at, id]);
}

type SourceRow = {
  id: string;
  url: string;
  title: string | null;
  publisher: string | null;
  kind: Source["kind"];
  published_at: string | null;
  fetched_at: number;
  snippet: string | null;
};

const toSource = (r: SourceRow): Source => ({
  id: r.id,
  url: r.url,
  title: r.title,
  publisher: r.publisher,
  kind: r.kind,
  publishedAt: r.published_at,
  fetchedAt: r.fetched_at,
  snippet: r.snippet,
});

export async function listSources(boardId: string): Promise<Source[]> {
  const rows = await all<SourceRow>(
    `SELECT * FROM sources WHERE board_id = ? AND discarded = 0 ORDER BY CAST(SUBSTRING(id, 2) AS UNSIGNED)`,
    [boardId],
  );
  return rows.map(toSource);
}

export async function addSources(boardId: string, docs: FoundDoc[]): Promise<Source[]> {
  const existing = new Set(
    (await all<{ url: string }>(`SELECT url FROM sources WHERE board_id = ?`, [boardId])).map((r) => r.url),
  );
  const max = await one<{ n: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(id, 2) AS UNSIGNED)), 0) AS n FROM sources WHERE board_id = ?`,
    [boardId],
  );
  let n = Number(max?.n ?? 0);
  const added: Source[] = [];
  const now = Date.now();
  for (const doc of docs) {
    const url = doc.url.split("#")[0];
    if (!url || existing.has(url)) continue;
    existing.add(url);
    n += 1;
    const s: Source = {
      id: `s${n}`,
      url,
      title: doc.title,
      publisher: doc.publisher?.slice(0, 255) ?? null,
      kind: doc.kind,
      publishedAt: doc.publishedAt?.slice(0, 64) ?? null,
      fetchedAt: now,
      snippet: doc.snippet,
    };
    added.push(s);
  }
  if (added.length) {
    const placeholders = added.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", ");
    await run(
      `INSERT IGNORE INTO sources (board_id, id, url, title, publisher, kind, published_at, fetched_at, snippet) VALUES ${placeholders}`,
      added.flatMap((s) => [boardId, s.id, s.url, s.title, s.publisher, s.kind, s.publishedAt, s.fetchedAt, s.snippet]),
    );
  }
  return added;
}

export async function discardSources(boardId: string, ids: string[]) {
  if (!ids.length) return;
  await run(`UPDATE sources SET discarded = 1 WHERE board_id = ? AND id IN (${ids.map(() => "?").join(", ")})`, [
    boardId,
    ...ids,
  ]);
}

export async function addEvent(
  boardId: string,
  kind: BoardEvent["kind"],
  message: string,
  data: Record<string, unknown> | null = null,
) {
  const ts = Date.now();
  const res = await run(`INSERT INTO events (board_id, ts, kind, message, data) VALUES (?, ?, ?, ?, ?)`, [
    boardId,
    ts,
    kind,
    message,
    data ? JSON.stringify(data) : null,
  ]);
  const event = { id: Number(res.insertId), ts, kind, message, data };
  publish({ type: "event", boardId, event });
  return event;
}

export async function listEvents(boardId: string, limit = 100): Promise<BoardEvent[]> {
  const rows = await all<{ id: number; ts: number; kind: BoardEvent["kind"]; message: string; data: string | null }>(
    `SELECT * FROM events WHERE board_id = ? ORDER BY id DESC LIMIT ?`,
    [boardId, limit],
  );
  return rows.map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, message: r.message, data: json(r.data) }));
}

export async function addMessage(boardId: string, role: "user" | "assistant", content: string) {
  await run(`INSERT INTO messages (board_id, role, content, ts) VALUES (?, ?, ?, ?)`, [boardId, role, content, Date.now()]);
}

export async function listMessages(boardId: string) {
  const rows = await all<{ role: "user" | "assistant"; content: string; ts: number }>(
    `SELECT role, content, ts FROM messages WHERE board_id = ? ORDER BY id`,
    [boardId],
  );
  return rows.map((r) => ({ role: r.role, content: r.content, ts: r.ts }));
}

export async function saveMonitor(id: string, boardId: string, kind: string, query: string, webhookSecret: string | null = null) {
  await run(
    `INSERT INTO monitors (id, board_id, kind, query, webhook_secret, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE board_id = VALUES(board_id), kind = VALUES(kind), query = VALUES(query), webhook_secret = VALUES(webhook_secret)`,
    [id, boardId, kind, query, webhookSecret, Date.now()],
  );
}

type MonitorRow = {
  id: string;
  board_id: string;
  kind: string;
  query: string;
  last_seen_change_at: string | null;
  webhook_secret: string | null;
};

export async function listMonitors(boardId?: string): Promise<MonitorRow[]> {
  return boardId
    ? all<MonitorRow>(`SELECT * FROM monitors WHERE board_id = ?`, [boardId])
    : all<MonitorRow>(`SELECT * FROM monitors`);
}

export async function monitorById(id: string): Promise<MonitorRow | undefined> {
  return one<MonitorRow>(`SELECT * FROM monitors WHERE id = ?`, [id]);
}

export async function setMonitorSeen(id: string, at: string) {
  await run(`UPDATE monitors SET last_seen_change_at = ? WHERE id = ?`, [at, id]);
}

export async function countRecentBoards(ownerId: string, sinceMs: number) {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boards WHERE owner_id = ? AND created_at >= ?`, [
    ownerId,
    sinceMs,
  ]);
  return Number(r?.n ?? 0);
}

export async function slugExists(slug: string) {
  return (await boardIdForSlug(slug)) !== null;
}
