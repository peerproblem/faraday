import { describe, expect, it } from "vitest";
import type { BoardRow } from "../repo/boards";
import type { DistributableEvent } from "../repo/distribution";
import type { StatItem } from "../spec";
import { discordMessage, discordWants, eventKey, gapPassed, linksFor, momentOf, topStats, xText, xWants, type Moment } from "./compose";

const ev = (over: Partial<DistributableEvent>): DistributableEvent => ({ id: 7, ts: 1000, boardId: "b1", kind: "update", message: "Deaths rose to 12.", data: { material: true, importance: "high" }, ...over });
const stat = (key: string, tone: StatItem["tone"], delta: string | null = null): StatItem => ({
  key, label: key, valueText: "12", valueNum: 12, unit: null, delta, deltaNum: null, tone, conflict: null, history: [], sources: [], asOf: null,
});
const board = {
  slug: "valencia-floods", version: 4, title: "row title",
  spec: { version: 2, widgets: [{ id: "stats", type: "stat-grid", title: "Figures", span: "full", bind: null, metrics: [] }] },
  data: {
    header: { title: "Valencia floods", subtitle: null, crisisType: "flood", accent: "blue", headline: { text: "Rivers are still rising.", sources: [] }, status: "ongoing",
      statusP: null, severity: 4, severityP: null, location: null, asOf: null, language: "en" },
    widgets: { stats: { items: [stat("Missing", "info"), stat("Deaths", "critical", "+3 since 09:00")] } }, hidden: [], generatedAt: 0,
  },
} as unknown as BoardRow;
const update: Moment = { kind: "update", eventId: 7, boardId: "b1", at: 1000, importance: "high", note: "Deaths rose to 12." };
const live: Moment = { kind: "new-topic", eventId: 3, boardId: "b1", at: 1000 };

describe("which events are posted", () => {
  it("posts a topic going live and material, non-silent updates of medium or high importance", () => {
    expect(momentOf(ev({ kind: "stage", message: "Board live in 41s" }))).toMatchObject({ kind: "new-topic" });
    expect(momentOf(ev({ kind: "stage", message: "Board written" }))).toBeNull();
    expect(momentOf(ev({}))).toMatchObject({ kind: "update", importance: "high", note: "Deaths rose to 12." });
    expect(momentOf(ev({ data: { material: false, importance: "high" } }))).toBeNull();
    expect(momentOf(ev({ data: { material: true, importance: "low" } }))).toBeNull();
    expect(momentOf(ev({ data: { material: true, importance: "high", silent: true } }))).toBeNull();
    // Fallback notes and social-only rounds say nothing worth a post.
    expect(momentOf(ev({ message: "New information arrived" }))).toBeNull();
    expect(momentOf(ev({ message: "On the ground: unverified social reports updated" }))).toBeNull();
  });
  it("keys a topic's launch once and each update by its event", () => {
    expect(eventKey(live)).toBe("live");
    expect(eventKey(update)).toBe("event:7");
  });
  it("sends X only new topics and high-importance changes", () => {
    expect(xWants(live)).toBe(true);
    expect(xWants(update)).toBe(true);
    expect(xWants({ ...update, importance: "medium" })).toBe(false);
  });
  it("sends a named follower every change, and an all-topics follower new topics and major changes", () => {
    expect(discordWants({ ...update, importance: "medium" }, { all: false })).toBe(true);
    expect(discordWants({ ...update, importance: "medium" }, { all: true })).toBe(false);
    expect(discordWants(update, { all: true })).toBe(true);
    expect(discordWants(live, { all: true })).toBe(true);
    expect(discordWants(live, { all: false })).toBe(false);
  });
  it("waits out the gap between posts about one topic, except for its launch", () => {
    expect(gapPassed(update, null, 60_000, 0)).toBe(true);
    expect(gapPassed(update, 0, 60_000, 59_999)).toBe(false);
    expect(gapPassed(update, 0, 60_000, 60_000)).toBe(true);
    expect(gapPassed(live, 0, 60_000, 1)).toBe(true);
  });
});

describe("what is posted", () => {
  const links = linksFor(board, "faraday.watch");
  it("links the board's own host and a versioned share image", () => {
    expect(links).toEqual({ board: "https://valencia-floods.faraday.watch", image: "https://faraday.watch/api/og/valencia-floods?v=4" });
    expect(linksFor(board, "")).toEqual({ board: "http://localhost:3000/b/valencia-floods", image: null });
  });
  it("writes X posts from the board's words and keeps them within 280 characters, links counted as 23", () => {
    expect(xText(live, board, links)).toBe("New live board: Valencia floods\n\nRivers are still rising.\n\nhttps://valencia-floods.faraday.watch");
    expect(xText(update, board, links)).toBe("Valencia floods: Deaths rose to 12.\n\nhttps://valencia-floods.faraday.watch");
    const long = xText({ ...update, note: "word ".repeat(100) }, board, links);
    const weighted = long.length - links.board.length + 23;
    expect(weighted).toBeLessThanOrEqual(280);
    expect(long.endsWith(`…\n\n${links.board}`)).toBe(true);
  });
  it("puts the most severe figures in a Discord embed that never pings anyone", () => {
    expect(topStats(board).map((s) => s.label)).toEqual(["Deaths", "Missing"]);
    const msg = discordMessage(update, board, links);
    expect(msg.content).toBe("Major update");
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.embeds[0]).toMatchObject({
      title: "Valencia floods", url: links.board, description: "Deaths rose to 12.", color: 0x3b82f6,
      fields: [{ name: "Deaths", value: "12 (+3 since 09:00)", inline: true }, { name: "Missing", value: "12", inline: true }],
      image: { url: links.image },
    });
    expect(discordMessage(live, board, links)).toMatchObject({ content: "New live board", embeds: [{ description: "Rivers are still rising." }] });
  });
});
