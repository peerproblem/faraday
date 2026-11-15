// Discord: a bot that server admins add, slash commands that subscribe a channel to topics, and the REST call that
// posts updates. Commands arrive over HTTP (the interactions endpoint), so no gateway connection is kept open.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { getBoard, listTopics } from "../repo/boards";
import { addFollow, ALL_TOPICS, channelFollows, removeFollows } from "../repo/distribution";
import { linksFor, titleOf, type DiscordMessage } from "./compose";

const API = "https://discord.com/api/v10";

export type DiscordConfig = { token: string; applicationId: string; publicKey: string };

export function discordConfig(env = process.env): DiscordConfig | null {
  const c = { token: env.DISCORD_BOT_TOKEN ?? "", applicationId: env.DISCORD_APPLICATION_ID ?? "", publicKey: env.DISCORD_PUBLIC_KEY ?? "" };
  return Object.values(c).every(Boolean) ? c : null;
}

/** View Channel, Send Messages and Embed Links: all the bot needs. */
export const BOT_PERMISSIONS = 1024n | 2048n | 16384n;

export const installUrl = (applicationId: string) =>
  `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}`;

// ---------- request signatures ----------

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const keys = new Map<string, KeyObject>();

function publicKey(hex: string): KeyObject {
  let k = keys.get(hex);
  if (!k) {
    k = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "spki" });
    keys.set(hex, k);
  }
  return k;
}

/** Discord signs `${timestamp}${body}` with Ed25519. Requests that fail this must get a 401. */
export function verifyDiscord(raw: string, signature: string | undefined, timestamp: string | undefined, publicKeyHex: string, nowMs = Date.now()): boolean {
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300) return false;
  try {
    return verify(null, Buffer.from(timestamp + raw), publicKey(publicKeyHex), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ---------- slash commands ----------

const MANAGE_CHANNELS = "16";
const topicOption = (description: string) => ({ type: 3, name: "topic", description, required: false, autocomplete: true });

/** Registered once per application with `npm run discord:commands`. */
export const COMMANDS = [
  { name: "follow", description: "Post Faraday updates about a topic in this channel", default_member_permissions: MANAGE_CHANNELS, contexts: [0],
    options: [topicOption("The topic to follow. Leave empty to follow new topics and major changes on all of them.")] },
  { name: "unfollow", description: "Stop Faraday updates in this channel", default_member_permissions: MANAGE_CHANNELS, contexts: [0],
    options: [topicOption("The topic to stop. Leave empty to stop everything in this channel.")] },
  { name: "following", description: "List the topics this channel follows", contexts: [0] },
  { name: "topics", description: "The crises Faraday is watching now, with links to their live boards", contexts: [0] },
];

type Option = { name: string; type: number; value?: string | number | boolean; focused?: boolean };
export type Interaction = {
  type: number;
  data?: { name?: string; options?: Option[] };
  channel_id?: string;
  channel?: { id?: string };
  guild_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  /** The bot's permissions in the channel, as a decimal bitfield. */
  app_permissions?: string;
};

type Reply = { type: number; data?: Record<string, unknown> };

const EPHEMERAL = 64;
const say = (content: string, ephemeral = true): Reply => ({
  type: 4,
  data: { content, allowed_mentions: { parse: [] }, ...(ephemeral ? { flags: EPHEMERAL } : {}) },
});

const ID = /^[a-z0-9]{1,32}$/;

/** A topic the bot may follow or post: a public, active shared topic that has finished its first build. */
async function liveTopic(boardId: string) {
  if (!ID.test(boardId)) return null;
  const b = await getBoard(boardId);
  return b && b.origin === "system" && b.visibility === "public" && b.topicState === "active" && b.data ? b : null;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Answers one interaction. Signature checks happen before this, in the route. */
export async function handleInteraction(i: Interaction, domain = process.env.FARADAY_DOMAIN ?? ""): Promise<Reply> {
  if (i.type === 1) return { type: 1 };
  const name = i.data?.name ?? "";
  const topicArg = i.data?.options?.find((o) => o.name === "topic");

  // Autocomplete: topic titles as the user types; the value is the board id.
  if (i.type === 4) {
    const q = String(topicArg?.value ?? "").toLowerCase().trim();
    const topics = await listTopics({ limit: 100 });
    const choices = topics
      .filter((t) => !q || (t.title ?? "").toLowerCase().includes(q) || (t.locationName ?? "").toLowerCase().includes(q))
      .slice(0, 25)
      .map((t) => ({ name: clip(t.title ?? t.slug, 100), value: t.id }));
    return { type: 8, data: { choices } };
  }
  if (i.type !== 2) return say("Unsupported interaction.");

  const channelId = i.channel_id ?? i.channel?.id ?? "";
  const userId = i.member?.user?.id ?? i.user?.id ?? null;

  if (name === "topics") {
    const topics = await listTopics({ limit: 10 });
    if (!topics.length) return say("Faraday is not watching any topics right now.", false);
    const lines = topics.map((t) => `- [${t.title ?? t.slug}](<${linksFor({ slug: t.slug, version: 0 }, domain).board}>)${t.headline ? `: ${clip(t.headline, 140)}` : ""}`);
    return say(clip(`Live boards on Faraday:\n${lines.join("\n")}`, 1900), false);
  }

  if (!i.guild_id || !channelId) return say("Use this in a server channel.");

  if (name === "following") {
    const rows = await channelFollows(channelId);
    if (!rows.length) return say("This channel follows nothing yet. An admin can start with /follow.");
    const lines = rows.map((r) => (r.boardId === ALL_TOPICS ? "- All topics (new topics and major changes)" : `- ${r.title ?? r.slug ?? "A topic that has ended"}`));
    return say(`This channel follows:\n${lines.join("\n")}`);
  }

  if (name === "follow") {
    // The bot has to be able to post here, or following would fail silently later.
    if (i.app_permissions !== undefined) {
      const perms = BigInt(/^\d+$/.test(i.app_permissions) ? i.app_permissions : "0");
      if ((perms & BOT_PERMISSIONS) !== BOT_PERMISSIONS) return say("Faraday cannot post here. Give it View Channel, Send Messages and Embed Links in this channel, then try again.");
    }
    const boardId = topicArg?.value ? String(topicArg.value) : ALL_TOPICS;
    if (boardId === ALL_TOPICS) {
      const added = await addFollow({ channelId, boardId, guildId: i.guild_id, createdBy: userId });
      return say(added ? "This channel now gets new topics and major changes from every Faraday board." : "This channel already follows all topics.");
    }
    const board = await liveTopic(boardId);
    if (!board) return say("That topic is not live. Pick one from the list as you type.");
    const added = await addFollow({ channelId, boardId, guildId: i.guild_id, createdBy: userId });
    const link = linksFor(board, domain).board;
    return say(added ? `This channel now follows [${titleOf(board)}](<${link}>). Material changes will be posted here.` : `This channel already follows ${titleOf(board)}.`);
  }

  if (name === "unfollow") {
    const boardId = topicArg?.value ? String(topicArg.value) : undefined;
    if (boardId !== undefined && boardId !== ALL_TOPICS && !ID.test(boardId)) return say("Pick a topic from the list as you type.");
    const n = await removeFollows(channelId, boardId);
    if (!n) return say(boardId ? "This channel was not following that topic." : "This channel was not following anything.");
    return say(boardId ? "Stopped. That topic will no longer post here." : "Stopped. Faraday will no longer post in this channel.");
  }

  return say("Unknown command.");
}

// ---------- posting ----------

export class DiscordGoneError extends Error {}

/**
 * Posts one message and returns its id. A channel that was deleted throws DiscordGoneError so its follows can be
 * removed. No retries.
 */
export async function postToDiscord(channelId: string, message: DiscordMessage, token: string, signal?: AbortSignal): Promise<string> {
  if (!/^\d{1,25}$/.test(channelId)) throw new DiscordGoneError("Invalid channel id");
  let res: Response;
  try {
    res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Discord post transport failed");
  }
  // 404: the channel is gone. A 403 (permissions changed) is left to the server's admins to fix, so follows stay.
  if (res.status === 404) throw new DiscordGoneError("Discord post HTTP 404");
  if (!res.ok) throw new Error(`Discord post HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) throw new Error("Discord post answered without a message id");
  return body.id;
}

/** Replaces the application's global commands with COMMANDS. */
export async function registerCommands(cfg: DiscordConfig): Promise<number> {
  const res = await fetch(`${API}/applications/${encodeURIComponent(cfg.applicationId)}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(COMMANDS),
  });
  if (!res.ok) throw new Error(`Discord command registration HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return ((await res.json()) as unknown[]).length;
}
