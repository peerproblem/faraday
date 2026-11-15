// What the distributor posts, and where. Pure, so the rules are tested without a database or network.
// Nothing here calls a model: every word and figure comes from the board as it already is (its header, its stat grid,
// and the change note the update graph wrote from verified facts).
import type { BoardRow } from "../repo/boards";
import type { DistributableEvent } from "../repo/distribution";
import type { Accent, StatItem } from "../spec";

const MIN = 60_000;

export type Moment =
  | { kind: "new-topic"; eventId: number; boardId: string; at: number }
  | { kind: "update"; eventId: number; boardId: string; at: number; importance: "medium" | "high"; note: string };

/** Which events are worth a post at all: a topic going live, or a material update that the board did not mark silent. */
export function momentOf(e: DistributableEvent): Moment | null {
  if (e.kind === "stage") return e.message.startsWith("Board live in ") ? { kind: "new-topic", eventId: e.id, boardId: e.boardId, at: e.ts } : null;
  const d = e.data ?? {};
  if (d.material !== true || d.silent === true) return null;
  const importance = d.importance;
  if (importance !== "medium" && importance !== "high") return null;
  const note = e.message.trim();
  if (!note || note === "New information arrived" || note.startsWith("On the ground:")) return null;
  return { kind: "update", eventId: e.id, boardId: e.boardId, at: e.ts, importance, note };
}

export const eventKey = (m: Moment) => (m.kind === "new-topic" ? "live" : `event:${m.eventId}`);

// ---------- policy ----------

const envNum = (name: string, fallback: number) => {
  const raw = process.env[name];
  const v = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const POLICY = {
  /** X posts per rolling 24 hours, across all topics. */
  xDaily: () => envNum("X_POST_DAILY_LIMIT", 10),
  /** Minimum gap between two X posts about one topic. */
  xBoardGapMs: () => envNum("X_POST_BOARD_GAP_MIN", 180) * MIN,
  /** Minimum gap between two posts about one topic in one Discord channel. */
  discordGapMs: () => envNum("DISCORD_POST_GAP_MIN", 10) * MIN,
  /** Events older than this are not posted (a worker that was down does not flood channels when it comes back). */
  maxAgeMs: () => envNum("DISTRIBUTE_MAX_AGE_MIN", 120) * MIN,
};

/** X carries only what matters to everyone: new topics and high-importance changes. */
export const xWants = (m: Moment) => m.kind === "new-topic" || m.importance === "high";

/**
 * A channel that named this topic hears about every material change. One that follows all topics hears about new
 * topics and high-importance changes, so "all" stays readable when many topics are live.
 */
export function discordWants(m: Moment, follower: { all: boolean }): boolean {
  if (m.kind === "new-topic") return follower.all;
  return follower.all ? m.importance === "high" : true;
}

/** True when the gap since the last post about this topic to this target has passed. A new topic always goes out. */
export const gapPassed = (m: Moment, lastAt: number | null, gapMs: number, now: number) =>
  m.kind === "new-topic" || lastAt === null || now - lastAt >= gapMs;

// ---------- content ----------

export const ACCENT_RGB: Record<Accent, number> = {
  red: 0xef4444,
  orange: 0xf97316,
  amber: 0xf59e0b,
  blue: 0x3b82f6,
  violet: 0x8b5cf6,
  teal: 0x14b8a6,
};

export type Links = { board: string; image: string | null };

/** Public addresses of a board. Without a domain (local runs) the links point at localhost. */
export function linksFor(board: Pick<BoardRow, "slug" | "version">, domain = process.env.FARADAY_DOMAIN ?? ""): Links {
  if (!domain) return { board: `http://localhost:3000/b/${board.slug}`, image: null };
  return { board: `https://${board.slug}.${domain}`, image: `https://${domain}/api/og/${encodeURIComponent(board.slug)}?v=${board.version}` };
}

const TONE_RANK: Record<StatItem["tone"], number> = { critical: 0, warning: 1, info: 2, ok: 3 };

/** Up to three figures from the stat grid, the most severe first: the same ones the share image shows. */
export function topStats(board: Pick<BoardRow, "spec" | "data">, max = 3): StatItem[] {
  const grid = board.spec?.widgets.find((w) => w.type === "stat-grid");
  if (!grid || board.data?.hidden.includes(grid.id)) return [];
  const data = board.data?.widgets[grid.id] as { items?: StatItem[] } | undefined;
  return (data?.items ?? [])
    .filter((s) => s.valueText?.trim())
    .map((s, i) => ({ s, i }))
    .sort((a, b) => TONE_RANK[a.s.tone] - TONE_RANK[b.s.tone] || a.i - b.i)
    .slice(0, max)
    .map(({ s }) => s);
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

export const titleOf = (board: Pick<BoardRow, "title" | "data">) => board.data?.header.title ?? board.title ?? "Live board";

/** X counts every link as 23 characters, whatever its length. */
const X_LIMIT = 280;
const X_URL = 23;

/**
 * A post for X: what happened in words the board already shows, then the board link (its card carries the figures).
 * New topic: "New live board: <title>" and the headline. Update: "<title>: <change note>".
 */
export function xText(m: Moment, board: Pick<BoardRow, "title" | "data">, links: Links): string {
  const title = titleOf(board);
  const body =
    m.kind === "new-topic"
      ? [`New live board: ${title}`, board.data?.header.headline?.text ?? board.data?.header.subtitle ?? ""].filter(Boolean).join("\n\n")
      : `${title}: ${m.note}`;
  const room = X_LIMIT - X_URL - 2;
  return `${clip(body, room)}\n\n${links.board}`;
}

export type DiscordMessage = {
  content: string;
  embeds: {
    title: string;
    url: string;
    description?: string;
    color: number;
    fields?: { name: string; value: string; inline: boolean }[];
    image?: { url: string };
    footer: { text: string };
    timestamp: string;
  }[];
  allowed_mentions: { parse: never[] };
};

/** A Discord message: a short line on why it was posted, and an embed with the headline or change and the top figures. */
export function discordMessage(m: Moment, board: Pick<BoardRow, "title" | "data" | "spec">, links: Links): DiscordMessage {
  const h = board.data?.header;
  const title = titleOf(board);
  const description = m.kind === "new-topic" ? (h?.headline?.text ?? h?.subtitle ?? undefined) : m.note;
  const fields = topStats(board).map((s) => ({
    name: clip(s.label, 256),
    value: clip(s.delta ? `${s.valueText} (${s.delta})` : s.valueText, 1024),
    inline: true,
  }));
  return {
    content: m.kind === "new-topic" ? "New live board" : m.importance === "high" ? "Major update" : "Update",
    embeds: [
      {
        title: clip(title, 256),
        url: links.board,
        ...(description ? { description: clip(description, 1000) } : {}),
        color: ACCENT_RGB[h?.accent ?? "teal"] ?? ACCENT_RGB.teal,
        ...(fields.length ? { fields } : {}),
        ...(links.image ? { image: { url: links.image } } : {}),
        footer: { text: "Faraday live board. Every figure links to its source." },
        timestamp: new Date(m.at).toISOString(),
      },
    ],
    // Board text never pings anyone, whatever it contains.
    allowed_mentions: { parse: [] },
  };
}
