import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all, run } from "../db/pool";
import { addEvent, createBoard, saveBoardVersion, setVisibility } from "../repo/boards";
import { addFollow, ALL_TOPICS, distributeCursor, followersOf } from "../repo/distribution";
import { useTestDb } from "../test/db";
import type { BoardData, BoardSpecV2 } from "../spec";
import { distributeOnce, type Senders } from "./run";

const spec = { version: 2, widgets: [] } as unknown as BoardSpecV2;
const data = (title: string) => ({
  header: { title, subtitle: null, crisisType: "flood", accent: "blue", headline: { text: `${title} is getting worse.`, sources: [] }, status: "ongoing",
    statusP: null, severity: 4, severityP: null, location: null, asOf: null, language: "en" },
  widgets: {}, hidden: [], generatedAt: 0,
}) as unknown as BoardData;

async function topic(title: string, origin: "system" | "user" = "system") {
  const { id } = await createBoard(`${title} ${Math.random()}`, null, { origin });
  await saveBoardVersion(id, { spec, data: data(title), changeNote: "Board built" });
  return id;
}

const update = (boardId: string, importance: string, note = "Deaths rose to 12.") => addEvent(boardId, "update", note, { material: true, importance, silent: importance === "low" });

function fakes() {
  const x = vi.fn(async (_text: string) => `x${Math.random()}`);
  const discord = vi.fn(async (_channel: string, _msg: unknown) => `d${Math.random()}`);
  return { x, discord, senders: { x, discord } as Senders };
}

const { enabled } = useTestDb("distribution");
describe.skipIf(!enabled)("distribution to X and Discord", () => {
  beforeEach(async () => {
    vi.stubEnv("DISTRIBUTE_ENABLED", "1");
    vi.stubEnv("FARADAY_DOMAIN", "faraday.watch");
    await run("DELETE FROM outbound_posts");
    await run("DELETE FROM discord_follows");
    await run("DELETE FROM events");
    await run("DELETE FROM app_settings WHERE name = 'distribute_cursor'");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("starts after the existing events, so turning it on never posts the backlog", async () => {
    const id = await topic("Backlog floods");
    await addEvent(id, "stage", "Board live in 40s");
    const { senders, x } = fakes();
    await distributeOnce(Date.now(), senders);
    expect(x).not.toHaveBeenCalled();
    const fresh = await update(id, "high");
    await distributeOnce(Date.now(), senders);
    expect(x).toHaveBeenCalledTimes(1);
    expect(await distributeCursor()).toBeGreaterThanOrEqual(fresh.id);
  });

  it("posts a new topic to X and all-topics channels, then changes to the channels that follow it", async () => {
    const { senders, x, discord } = fakes();
    await distributeOnce(Date.now(), senders); // sets the cursor
    const id = await topic("Valencia floods");
    await addFollow({ channelId: "100", boardId: ALL_TOPICS, guildId: "1", createdBy: null });
    await addEvent(id, "stage", "Board live in 41s");
    let r = await distributeOnce(Date.now(), senders);
    expect(r).toMatchObject({ sent: 2, failed: 0 });
    expect(x.mock.calls[0][0]).toBe("New live board: Valencia floods\n\nValencia floods is getting worse.\n\n" + `https://${(await all<{ slug: string }>("SELECT slug FROM boards WHERE id = ?", [id]))[0].slug}.faraday.watch`);
    expect(discord.mock.calls[0][0]).toBe("100");

    // A medium change reaches only the channel that named the topic; X waits for high importance.
    await addFollow({ channelId: "200", boardId: id, guildId: "1", createdBy: null });
    expect((await followersOf(id)).sort((a, b) => a.channelId.localeCompare(b.channelId))).toEqual([{ channelId: "100", all: true }, { channelId: "200", all: false }]);
    await update(id, "medium");
    r = await distributeOnce(Date.now(), senders);
    expect(r.sent).toBe(1);
    expect(discord.mock.calls.at(-1)?.[0]).toBe("200");
    expect(x).toHaveBeenCalledTimes(1);
    // A low or silent change is never posted.
    await update(id, "low");
    r = await distributeOnce(Date.now(), senders);
    expect(r.sent).toBe(0);
  });

  it("keeps the gap per topic and the daily X cap, and never posts the same event twice", async () => {
    vi.stubEnv("X_POST_DAILY_LIMIT", "2");
    const { senders, x } = fakes();
    await distributeOnce(Date.now(), senders);
    const a = await topic("Topic A");
    const b = await topic("Topic B");
    const c = await topic("Topic C");
    await update(a, "high");
    await update(a, "high", "Second change inside the gap.");
    await update(b, "high");
    await update(c, "high");
    const r = await distributeOnce(Date.now(), senders);
    // A's second change is inside the 3 hour gap; C is over the cap of 2.
    expect(x).toHaveBeenCalledTimes(2);
    expect(r.skipped).toBe(2);
    await run("UPDATE app_settings SET value = '0' WHERE name = 'distribute_cursor'");
    vi.stubEnv("X_POST_DAILY_LIMIT", "10");
    vi.stubEnv("X_POST_BOARD_GAP_MIN", "0");
    // Rewound cursor: every event is read again, but only the ones never claimed go out.
    await distributeOnce(Date.now(), senders);
    expect(x).toHaveBeenCalledTimes(4);
  });

  it("skips legacy, unlisted and stale boards, and records a dry run without sending", async () => {
    const { senders, x } = fakes();
    await distributeOnce(Date.now(), senders);
    const legacy = await topic("Legacy board", "user");
    const unlisted = await topic("Unlisted topic");
    await setVisibility(unlisted, "unlisted");
    await update(legacy, "high");
    await update(unlisted, "high");
    const stale = await topic("Stale topic");
    await update(stale, "high");
    await distributeOnce(Date.now() + 3 * 3_600_000, senders);
    expect(x).not.toHaveBeenCalled();

    vi.stubEnv("DISTRIBUTE_DRY_RUN", "1");
    const live = await topic("Dry topic");
    await update(live, "high");
    const r = await distributeOnce(Date.now(), senders);
    expect(r).toMatchObject({ dry: 1, sent: 0 });
    expect(x).not.toHaveBeenCalled();
    expect(await all("SELECT target, status FROM outbound_posts")).toEqual([{ target: "dry:x", status: "dry" }]);
  });

  it("removes the follows of a deleted Discord channel and keeps going", async () => {
    const { DiscordGoneError } = await import("./discord");
    const discord = vi.fn(async (channel: string) => {
      if (channel === "300") throw new DiscordGoneError("Discord post HTTP 404");
      return "ok";
    });
    const senders: Senders = { x: null, discord };
    await distributeOnce(Date.now(), senders);
    const id = await topic("Gone channel topic");
    await addFollow({ channelId: "300", boardId: id, guildId: "1", createdBy: null });
    await addFollow({ channelId: "301", boardId: id, guildId: "1", createdBy: null });
    await update(id, "medium");
    const r = await distributeOnce(Date.now(), senders);
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect((await followersOf(id)).map((f) => f.channelId)).toEqual(["301"]);
  });

  it("does nothing while off", async () => {
    vi.stubEnv("DISTRIBUTE_ENABLED", "0");
    const { senders } = fakes();
    expect(await distributeOnce(Date.now(), senders)).toEqual({ events: 0, sent: 0, dry: 0, failed: 0, skipped: 0 });
    expect(await all("SELECT * FROM app_settings WHERE name = 'distribute_cursor'")).toEqual([]);
  });
});
