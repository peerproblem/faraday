// Outbound distribution: Discord follows, the post log for X and Discord, and the event cursor the worker reads from.
import { all, one, run } from "../db/pool";
import { getSetting, setSetting } from "./settings";

/** A Discord channel following every shared topic. */
export const ALL_TOPICS = "*";

export type Channel = "x" | "discord";
export type PostStatus = "pending" | "sent" | "failed" | "dry";

// ---------- Discord follows ----------

export type DiscordFollow = { channelId: string; boardId: string; guildId: string | null };

export async function addFollow(f: DiscordFollow & { createdBy: string | null }, at = Date.now()): Promise<boolean> {
  const r = await run(
    `INSERT IGNORE INTO discord_follows (channel_id, board_id, guild_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
    [f.channelId, f.boardId, f.guildId, f.createdBy, at],
  );
  return r.affectedRows > 0;
}

/** Without a board, every follow of the channel. Returns how many were removed. */
export async function removeFollows(channelId: string, boardId?: string): Promise<number> {
  const r = boardId
    ? await run(`DELETE FROM discord_follows WHERE channel_id = ? AND board_id = ?`, [channelId, boardId])
    : await run(`DELETE FROM discord_follows WHERE channel_id = ?`, [channelId]);
  return r.affectedRows;
}

export async function channelFollows(channelId: string): Promise<{ boardId: string; title: string | null; slug: string | null }[]> {
  const rows = await all<{ board_id: string; title: string | null; slug: string | null }>(
    `SELECT f.board_id, b.title, b.slug FROM discord_follows f LEFT JOIN boards b ON b.id = f.board_id
     WHERE f.channel_id = ? ORDER BY f.created_at`,
    [channelId],
  );
  return rows.map((r) => ({ boardId: r.board_id, title: r.title, slug: r.slug }));
}

/** Channels that follow this board, each with whether it follows it by name or through "all topics". */
export async function followersOf(boardId: string): Promise<{ channelId: string; all: boolean }[]> {
  const rows = await all<{ channel_id: string; board_id: string }>(
    `SELECT channel_id, board_id FROM discord_follows WHERE board_id IN (?, ?)`,
    [boardId, ALL_TOPICS],
  );
  // A channel that follows both ways counts once, as a named follower (it gets the most).
  const out = new Map<string, boolean>();
  for (const r of rows) out.set(r.channel_id, (out.get(r.channel_id) ?? true) && r.board_id === ALL_TOPICS);
  return [...out].map(([channelId, all]) => ({ channelId, all }));
}

// ---------- post log ----------

/** Claims one post before it is sent. False when it was already claimed (by this or another worker). */
export async function claimPost(p: { channel: Channel; target: string; boardId: string; eventKey: string }, at = Date.now()): Promise<boolean> {
  const r = await run(
    `INSERT IGNORE INTO outbound_posts (channel, target, board_id, event_key, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
    [p.channel, p.target, p.boardId, p.eventKey, at],
  );
  return r.affectedRows > 0;
}

export async function finishPost(
  p: { channel: Channel; target: string; boardId: string; eventKey: string },
  result: { status: Exclude<PostStatus, "pending">; externalId?: string | null; error?: string | null },
): Promise<void> {
  await run(
    `UPDATE outbound_posts SET status = ?, external_id = ?, error = ? WHERE channel = ? AND target = ? AND board_id = ? AND event_key = ?`,
    [result.status, result.externalId ?? null, result.error?.slice(0, 500) ?? null, p.channel, p.target, p.boardId, p.eventKey],
  );
}

/** When this target last got a post about this board (sent or dry run), or null. */
export async function lastPostAt(channel: Channel, target: string, boardId: string): Promise<number | null> {
  const r = await one<{ t: number | null }>(
    `SELECT MAX(created_at) t FROM outbound_posts WHERE channel = ? AND target = ? AND board_id = ? AND status IN ('sent', 'dry', 'pending')`,
    [channel, target, boardId],
  );
  return r?.t === null || r?.t === undefined ? null : Number(r.t);
}

/** Posts on a channel since a time, for the daily cap. A dry run counts only its own rows, a live run only real ones. */
export async function countPostsSince(channel: Channel, since: number, dry = false): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT COUNT(*) n FROM outbound_posts WHERE channel = ? AND created_at >= ? AND ${dry ? "status = 'dry'" : "status IN ('sent', 'pending')"}`,
    [channel, since],
  );
  return Number(r?.n ?? 0);
}

export type PostRow = {
  channel: Channel;
  target: string;
  boardId: string;
  eventKey: string;
  status: PostStatus;
  externalId: string | null;
  error: string | null;
  createdAt: number;
};

export async function recentPosts(limit = 50): Promise<PostRow[]> {
  const rows = await all<{ channel: Channel; target: string; board_id: string; event_key: string; status: PostStatus; external_id: string | null; error: string | null; created_at: number }>(
    `SELECT channel, target, board_id, event_key, status, external_id, error, created_at FROM outbound_posts ORDER BY id DESC LIMIT ?`,
    [Math.max(1, Math.min(200, Math.floor(limit)))],
  );
  return rows.map((r) => ({ channel: r.channel, target: r.target, boardId: r.board_id, eventKey: r.event_key, status: r.status,
    externalId: r.external_id, error: r.error, createdAt: Number(r.created_at) }));
}

// ---------- event cursor ----------

export type DistributableEvent = { id: number; ts: number; boardId: string; kind: "stage" | "update"; message: string; data: Record<string, unknown> | null };

/**
 * The last event id the distributor has looked at. On the very first run it starts at the newest event,
 * so turning distribution on never posts the backlog.
 */
export async function distributeCursor(): Promise<number> {
  const v = await getSetting("distribute_cursor");
  if (v !== null && /^\d+$/.test(v)) return Number(v);
  const r = await one<{ id: number | null }>(`SELECT MAX(id) id FROM events`);
  const start = Number(r?.id ?? 0);
  await setSetting("distribute_cursor", String(start));
  return start;
}

export async function setDistributeCursor(id: number): Promise<void> {
  await setSetting("distribute_cursor", String(id));
}

/**
 * Events after the cursor that may be worth a post: a shared topic going live, and board updates. Only public,
 * active shared topics count; legacy prompt boards and unlisted boards are never posted.
 */
export async function eventsAfter(cursor: number, limit = 100): Promise<{ events: DistributableEvent[]; lastId: number }> {
  // The newest id first, then only events up to it: an event written between the two reads waits for the next run.
  const last = await one<{ id: number | null }>(`SELECT MAX(id) id FROM events WHERE id > ?`, [cursor]);
  const upto = Number(last?.id ?? cursor);
  if (upto <= cursor) return { events: [], lastId: cursor };
  const rows = await all<{ id: number; ts: number; board_id: string; kind: "stage" | "update"; message: string; data: string | null }>(
    `SELECT e.id, e.ts, e.board_id, e.kind, e.message, e.data FROM events e
     JOIN boards b ON b.id = e.board_id
     WHERE e.id > ? AND e.id <= ? AND b.deleted_at IS NULL AND b.origin = 'system' AND b.visibility = 'public' AND b.topic_state = 'active'
       AND (e.kind = 'update' OR (e.kind = 'stage' AND e.message LIKE 'Board live in %'))
     ORDER BY e.id LIMIT ?`,
    [cursor, upto, limit],
  );
  const events = rows.map((r) => ({ id: Number(r.id), ts: Number(r.ts), boardId: r.board_id, kind: r.kind, message: r.message,
    data: typeof r.data === "string" && r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null }));
  // The cursor also moves past events that did not qualify. A full page means more qualifying events may follow,
  // so it stops at the last one read instead of skipping them.
  const lastId = rows.length === limit ? events[events.length - 1].id : upto;
  return { events, lastId };
}
