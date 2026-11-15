import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repo/boards", () => ({ getBoard: vi.fn(), listTopics: vi.fn() }));
vi.mock("../repo/distribution", () => ({ ALL_TOPICS: "*", addFollow: vi.fn(async () => true), removeFollows: vi.fn(async () => 1), channelFollows: vi.fn(async () => []) }));
const { getBoard, listTopics } = await import("../repo/boards");
const { addFollow, removeFollows, channelFollows } = await import("../repo/distribution");
const { BOT_PERMISSIONS, DiscordGoneError, handleInteraction, postToDiscord, verifyDiscord } = await import("./discord");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
const now = 1_763_200_000_000;
const ts = String(Math.floor(now / 1000));
const sigOf = (body: string, t = ts) => sign(null, Buffer.from(t + body), privateKey).toString("hex");

const topic = { id: "abc123", slug: "valencia-floods", version: 2, title: "Valencia floods", origin: "system", visibility: "public", topicState: "active",
  data: { header: { title: "Valencia floods" } } };
const cmd = (name: string, topicValue?: string, extra: Record<string, unknown> = {}) => ({
  type: 2, guild_id: "1", channel_id: "42", member: { user: { id: "9" } }, app_permissions: String(BOT_PERMISSIONS),
  data: { name, options: topicValue === undefined ? [] : [{ name: "topic", type: 3, value: topicValue }] }, ...extra,
});
const content = (r: { data?: Record<string, unknown> }) => String(r.data?.content ?? "");

beforeEach(() => {
  vi.mocked(getBoard).mockResolvedValue(topic as never);
  vi.mocked(listTopics).mockResolvedValue([
    { id: "abc123", slug: "valencia-floods", title: "Valencia floods", headline: "Rivers are still rising.", locationName: "Valencia" },
    { id: "def456", slug: "kyiv-outages", title: "Kyiv power outages", headline: null, locationName: "Kyiv" },
  ] as never);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("Discord request signatures", () => {
  it("accepts Discord's Ed25519 signature and refuses anything else", () => {
    const body = '{"type":1}';
    expect(verifyDiscord(body, sigOf(body), ts, pubHex, now)).toBe(true);
    expect(verifyDiscord('{"type":2}', sigOf(body), ts, pubHex, now)).toBe(false);
    expect(verifyDiscord(body, undefined, ts, pubHex, now)).toBe(false);
    expect(verifyDiscord(body, "zz", ts, pubHex, now)).toBe(false);
    // A replayed request from long ago.
    const old = String(Math.floor(now / 1000) - 600);
    expect(verifyDiscord(body, sigOf(body, old), old, pubHex, now)).toBe(false);
  });
});

describe("slash commands", () => {
  it("answers Discord's ping", async () => {
    expect(await handleInteraction({ type: 1 })).toEqual({ type: 1 });
  });
  it("suggests live topics by title or place as the user types", async () => {
    const r = await handleInteraction({ type: 4, data: { name: "follow", options: [{ name: "topic", type: 3, value: "kyiv", focused: true }] } });
    expect(r).toEqual({ type: 8, data: { choices: [{ name: "Kyiv power outages", value: "def456" }] } });
  });
  it("follows one topic, or all of them when no topic is given", async () => {
    expect(content(await handleInteraction(cmd("follow", "abc123"), "faraday.watch"))).toContain("now follows [Valencia floods](<https://valencia-floods.faraday.watch>)");
    expect(addFollow).toHaveBeenLastCalledWith({ channelId: "42", boardId: "abc123", guildId: "1", createdBy: "9" });
    expect(content(await handleInteraction(cmd("follow")))).toContain("every Faraday board");
    expect(addFollow).toHaveBeenLastCalledWith(expect.objectContaining({ boardId: "*" }));
  });
  it("refuses topics that are not live and channels the bot cannot post in", async () => {
    vi.mocked(getBoard).mockResolvedValueOnce({ ...topic, origin: "user" } as never);
    expect(content(await handleInteraction(cmd("follow", "abc123")))).toContain("not live");
    expect(content(await handleInteraction(cmd("follow", "abc123", { app_permissions: "1024" })))).toContain("cannot post here");
    expect(content(await handleInteraction(cmd("follow", "abc123", { guild_id: undefined })))).toContain("server channel");
    expect(addFollow).not.toHaveBeenCalled();
  });
  it("unfollows one topic or everything, and lists what the channel follows", async () => {
    await handleInteraction(cmd("unfollow", "abc123"));
    expect(removeFollows).toHaveBeenLastCalledWith("42", "abc123");
    await handleInteraction(cmd("unfollow"));
    expect(removeFollows).toHaveBeenLastCalledWith("42", undefined);
    vi.mocked(channelFollows).mockResolvedValueOnce([{ boardId: "*", title: null, slug: null }, { boardId: "abc123", title: "Valencia floods", slug: "valencia-floods" }]);
    expect(content(await handleInteraction(cmd("following")))).toBe("This channel follows:\n- All topics (new topics and major changes)\n- Valencia floods");
  });
  it("lists live boards publicly with links that do not unfurl", async () => {
    const r = await handleInteraction(cmd("topics"), "faraday.watch");
    expect(r.data?.flags).toBeUndefined();
    expect(content(r)).toContain("- [Valencia floods](<https://valencia-floods.faraday.watch>): Rivers are still rising.");
  });
});

describe("posting to a channel", () => {
  it("returns the message id, and flags a deleted channel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "555" })));
    expect(await postToDiscord("42", { content: "x", embeds: [], allowed_mentions: { parse: [] } }, "token")).toBe("555");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(postToDiscord("42", { content: "x", embeds: [], allowed_mentions: { parse: [] } }, "token")).rejects.toBeInstanceOf(DiscordGoneError);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await expect(postToDiscord("42", { content: "x", embeds: [], allowed_mentions: { parse: [] } }, "token")).rejects.not.toBeInstanceOf(DiscordGoneError);
  });
});
