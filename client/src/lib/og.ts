// What a board's share image shows, picked from the board's own data. Pure, so it is tested without rendering.
// No model writes any of it: the title, headline and figures are the ones the board already shows.
import type { BoardView } from "./spec";
import type { Accent, SituationStatus } from "./spec/common";
import type { StatItem } from "./spec/widgets";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The share image is drawn by Satori on the server, outside the page, so design system variables do not reach it.
 * These match the dark theme it is drawn in.
 */
export const OG_COLORS = { bg: "#0b0d10", fg: "#e8ecf1", muted: "#8b95a3", panel: "#151a21" };

export const ACCENT_HEX: Record<Accent, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  teal: "#14b8a6",
};

const TONE_RANK: Record<StatItem["tone"], number> = { critical: 0, warning: 1, info: 2, ok: 3 };

export type OgStat = { label: string; value: string; delta: string | null };

export type OgCard = {
  title: string;
  kicker: string;
  headline: string | null;
  status: SituationStatus | null;
  accent: string;
  stats: OgStat[];
  updatedAt: number;
};

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/** Up to three figures from the board's stat grid, the most severe first, then in the board's own order. */
export function pickStats(board: Pick<BoardView, "spec" | "data">, max = 3): OgStat[] {
  const grid = board.spec?.widgets.find((w) => w.type === "stat-grid");
  const data = grid ? board.data?.widgets[grid.id] : undefined;
  if (!data || !("items" in data) || board.data?.hidden.includes(grid!.id)) return [];
  const items = (data.items as StatItem[]).filter((s) => s.valueText?.trim());
  return items
    .map((s, i) => ({ s, i }))
    .sort((a, b) => TONE_RANK[a.s.tone] - TONE_RANK[b.s.tone] || a.i - b.i)
    .slice(0, max)
    .map(({ s }) => ({ label: clip(s.label, 28), value: clip(s.valueText, 22), delta: s.delta ? clip(s.delta, 24) : null }));
}

export function ogCard(board: Pick<BoardView, "title" | "spec" | "data" | "updatedAt">): OgCard {
  const h = board.data?.header;
  const type = h?.crisisType && h.crisisType !== "other" ? h.crisisType : null;
  const kicker = [type ? type[0].toUpperCase() + type.slice(1) : "Live board", h?.location?.name].filter(Boolean).join(", ");
  return {
    title: clip(h?.title ?? board.title ?? "Faraday board", 60),
    kicker: clip(kicker, 60),
    headline: h?.headline?.text ? clip(h.headline.text, 125) : (h?.subtitle ? clip(h.subtitle, 125) : null),
    status: h?.status ?? null,
    accent: ACCENT_HEX[h?.accent ?? "teal"] ?? ACCENT_HEX.teal,
    stats: pickStats(board),
    updatedAt: board.data?.generatedAt ?? board.updatedAt,
  };
}

/** "15 Nov, 14:05 UTC": share images are cached by the platforms, so the time is absolute, never "5 min ago". */
export function ogTime(t: number): string {
  const d = new Date(t);
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const hm = d.toISOString().slice(11, 16);
  return `${d.getUTCDate()} ${month}, ${hm} UTC`;
}

/** The card for a board that is unknown or not built yet, so a shared link never shows a broken image. */
export const FALLBACK_CARD: OgCard = { title: "Live boards for the crises unfolding now", kicker: "Faraday", headline: null, status: null, accent: ACCENT_HEX.teal, stats: [], updatedAt: 0 };

/** Where a board's share image is served. The version busts the platforms' caches when the board changes. */
export const ogImagePath = (slug: string, version: number) => `/api/og/${encodeURIComponent(slug)}?v=${version}`;
