// The distributor: reads new board events, decides which are worth a post, and sends them to X and to the Discord
// channels that follow the topic. The worker runs it once a minute.
//
// Off unless DISTRIBUTE_ENABLED=1. With DISTRIBUTE_DRY_RUN=1 it records what it would post (status "dry") and sends
// nothing, so the rules can be watched on real events before any account is connected.
import { errMessage, log } from "../http/log";
import { getBoard } from "../repo/boards";
import {
  claimPost,
  countPostsSince,
  distributeCursor,
  eventsAfter,
  finishPost,
  followersOf,
  lastPostAt,
  removeFollows,
  setDistributeCursor,
  type Channel,
} from "../repo/distribution";
import { discordMessage, discordWants, eventKey, gapPassed, linksFor, momentOf, POLICY, xText, xWants, type DiscordMessage } from "./compose";
import { discordConfig, DiscordGoneError, postToDiscord } from "./discord";
import { postToX, xCreds } from "./x-post";

const DAY = 86_400_000;

export const distributeEnabled = () => process.env.DISTRIBUTE_ENABLED === "1";
const dryRun = () => process.env.DISTRIBUTE_DRY_RUN === "1";

export type Senders = {
  x: ((text: string) => Promise<string>) | null;
  discord: ((channelId: string, message: DiscordMessage) => Promise<string>) | null;
};

/** The live senders for whatever accounts are configured. */
export function liveSenders(): Senders {
  const x = xCreds();
  const dc = discordConfig();
  return {
    x: x ? (text) => postToX(text, x) : null,
    discord: dc ? (channelId, message) => postToDiscord(channelId, message, dc.token) : null,
  };
}

export type DistributeResult = { events: number; sent: number; dry: number; failed: number; skipped: number };

/** Claims, sends and records one post. A claim that already exists means it went out (or was tried) before. */
async function deliver(
  key: { channel: Channel; target: string; boardId: string; eventKey: string },
  send: (() => Promise<string>) | null,
  r: DistributeResult,
): Promise<void> {
  if (!(await claimPost(key))) return;
  if (!send) {
    await finishPost(key, { status: "dry" });
    r.dry++;
    log("info", "distribute dry run", { ...key });
    return;
  }
  try {
    const externalId = await send();
    await finishPost(key, { status: "sent", externalId });
    r.sent++;
    log("info", "distribute sent", { ...key, externalId });
  } catch (e) {
    await finishPost(key, { status: "failed", error: errMessage(e) });
    r.failed++;
    log("warn", "distribute failed", { ...key, error: errMessage(e) });
    // A deleted channel stops following everything.
    if (e instanceof DiscordGoneError && key.channel === "discord") await removeFollows(key.target);
  }
}

export async function distributeOnce(now = Date.now(), senders: Senders = liveSenders()): Promise<DistributeResult> {
  const r: DistributeResult = { events: 0, sent: 0, dry: 0, failed: 0, skipped: 0 };
  if (!distributeEnabled()) return r;
  const dry = dryRun();
  // Nothing to send to and not rehearsing: leave the cursor alone so turning an account on later starts from here.
  if (!dry && !senders.x && !senders.discord) return r;
  const cursor = await distributeCursor();
  const { events, lastId } = await eventsAfter(cursor);
  for (const e of events) {
    const m = momentOf(e);
    if (!m) continue;
    r.events++;
    if (now - m.at > POLICY.maxAgeMs()) {
      r.skipped++;
      continue;
    }
    const board = await getBoard(m.boardId);
    if (!board?.data) continue;
    const links = linksFor(board);
    const target = (t: string) => (dry ? `dry:${t}` : t);
    const base = { boardId: m.boardId, eventKey: eventKey(m) };

    if ((senders.x || dry) && xWants(m)) {
      const xTarget = target("x");
      const underCap = (await countPostsSince("x", now - DAY, dry)) < POLICY.xDaily();
      if (underCap && gapPassed(m, await lastPostAt("x", xTarget, m.boardId), POLICY.xBoardGapMs(), now)) {
        const text = xText(m, board, links);
        await deliver({ channel: "x", target: xTarget, ...base }, dry || !senders.x ? null : () => senders.x!(text), r);
      } else r.skipped++;
    }

    if (senders.discord || dry) {
      const message = discordMessage(m, board, links);
      for (const f of await followersOf(m.boardId)) {
        if (!discordWants(m, f)) continue;
        const dTarget = target(f.channelId);
        if (!gapPassed(m, await lastPostAt("discord", dTarget, m.boardId), POLICY.discordGapMs(), now)) {
          r.skipped++;
          continue;
        }
        await deliver({ channel: "discord", target: dTarget, ...base }, dry || !senders.discord ? null : () => senders.discord!(f.channelId, message), r);
      }
    }
  }
  if (lastId > cursor) await setDistributeCursor(lastId);
  return r;
}

