import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { subscribe, subscribeAll, publish, subscriberCount } from "../bus";
import { one, all } from "../db/pool";
import { removeBoardMonitors, runBoardMonitors } from "../monitors";
import {
  addEvent,
  addMessage,
  boardIdForSlug,
  countActiveBoards,
  countRecentBoards,
  createBoard,
  deleteBoard,
  getBoard,
  getBoardView,
  listBoards,
  listEvents,
  monitorById,
  setSchedule,
  setVisibility,
  slugExists,
  touchViewed,
  type BoardRow,
} from "../repo/boards";
import { enqueue, hasPendingJob, queueStats } from "../repo/jobs";
import { latestRunView, latestWorkerHeartbeat, nodeStats } from "../repo/runs";
import { sessionUserId } from "../session";
import type { BoardEvent, BoardView, StreamMsg } from "../spec";
import { upsertUser } from "../users";
import { errMessage, log } from "./log";
import { createLimiter } from "./rate-limit";
import { bearerOk, verifySignature } from "./signature";
import { createViewCache, etagFor, etagMatches } from "./view-cache";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export type AppOptions = {
  domain?: string;
  boardsPerHour?: number;
  maxActiveBoards?: number;
  maxQueuedBuilds?: number;
  editsPerHour?: number;
  pingMs?: number;
};

/** Tracks SSE connections and when each board was last recorded as viewed. */
export const sseState = { connections: 0, touchedAt: new Map<string, number>() };

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function createApp(opts: AppOptions = {}) {
  const DOMAIN = opts.domain ?? process.env.FARADAY_DOMAIN ?? "";
  const BOARDS_PER_HOUR = opts.boardsPerHour ?? num(process.env.BOARDS_PER_HOUR, 10);
  const MAX_ACTIVE = opts.maxActiveBoards ?? num(process.env.MAX_ACTIVE_BOARDS, 5);
  const MAX_QUEUED_BUILDS = opts.maxQueuedBuilds ?? num(process.env.MAX_QUEUED_BUILDS, 20);
  const EDITS_PER_HOUR = opts.editsPerHour ?? num(process.env.EDITS_PER_HOUR, 20);
  const PING_MS = opts.pingMs ?? 20_000;

  const refreshPerBoard = createLimiter({ windowMs: 60_000, max: 1 });
  const refreshPerIp = createLimiter({ windowMs: 60_000, max: 5 });
  const editsPerUser = createLimiter({ windowMs: 3_600_000, max: EDITS_PER_HOUR });
  const writesPerIp = createLimiter({ windowMs: 60_000, max: 60 });
  const cache = createViewCache(5_000);
  const unsubscribeCache = subscribeAll(({ boardId }) => cache.invalidate(boardId));

  function allowedOrigin(origin: string) {
    try {
      const u = new URL(origin);
      if (!DOMAIN) return u.hostname === "localhost" || u.hostname === "127.0.0.1";
      return u.protocol === "https:" && (u.hostname === DOMAIN || u.hostname.endsWith(`.${DOMAIN}`));
    } catch {
      return false;
    }
  }

  function remoteAddress(c: Context) {
    try {
      return getConnInfo(c).remote.address ?? "";
    } catch {
      return "";
    }
  }

  const isLoopback = (c: Context) => LOOPBACK.has(remoteAddress(c));

  /** Caddy sits in front on loopback and sets X-Forwarded-For; only trust it then. */
  function clientIp(c: Context) {
    const remote = remoteAddress(c);
    const fwd = c.req.header("x-forwarded-for");
    if (fwd && (LOOPBACK.has(remote) || remote === "")) return fwd.split(",")[0].trim();
    return remote || "unknown";
  }

  const uid = (c: Context) => sessionUserId(c.req.header("cookie"));

  async function ownedBoard(c: Context): Promise<{ row: BoardRow; uid: string } | Response> {
    const id = c.req.param("id") ?? "";
    const [user, row] = await Promise.all([uid(c), getBoard(id)]);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (!user || user !== row.ownerId) return c.json({ error: "Only the owner can change this board" }, 403);
    return { row, uid: user };
  }

  async function emitEvent(boardId: string, kind: BoardEvent["kind"], message: string, data: Record<string, unknown> | null = null) {
    const event = await addEvent(boardId, kind, message, data);
    publish(boardId, { type: "event", event });
    return event;
  }

  async function view(id: string): Promise<BoardView | null> {
    const cached = cache.get(id);
    if (cached) return cached;
    const v = await getBoardView(id);
    if (v) cache.set(id, v);
    return v;
  }

  function sendView(c: Context, v: BoardView | null) {
    if (!v) return c.json({ error: "Not found" }, 404);
    const etag = etagFor(v);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache");
    if (etagMatches(c.req.header("if-none-match"), etag)) return c.body(null, 304);
    return c.json(v);
  }

  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (origin && allowedOrigin(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "If-None-Match", "Last-Event-ID"],
      exposeHeaders: ["ETag"],
      maxAge: 600,
    }),
  );

  const tooLarge = (c: Context) => c.json({ error: "Request body too large" }, 413);
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }));
  // Partial boards from the worker can be large.
  app.use("/internal/*", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: tooLarge }));

  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST" || c.req.method === "DELETE") {
      if (c.req.path.startsWith("/api/webhooks/") || c.req.path.startsWith("/api/internal/")) return next();
      const r = writesPerIp.hit(clientIp(c));
      if (!r.ok) {
        c.header("Retry-After", String(Math.ceil(r.retryAfterMs / 1000)));
        return c.json({ error: "Too many requests, slow down a little" }, 429);
      }
    }
    return next();
  });

  app.get("/health", async (c) => {
    try {
      await one(`SELECT 1 AS ok`);
    } catch (e) {
      log("error", "health: database unreachable", { error: errMessage(e) });
      return c.json({ ok: false, error: "database unreachable" }, 503);
    }
    let beat: number | null = null;
    try {
      beat = await latestWorkerHeartbeat();
    } catch {}
    const degraded = !beat || Date.now() - beat > 120_000;
    return c.json(degraded ? { ok: true, degraded: true, worker: beat } : { ok: true, worker: beat });
  });

  app.get("/", (c) => c.redirect(DOMAIN ? `https://${DOMAIN}` : "http://localhost:3000"));

  // Caddy asks this before issuing a certificate for <slug>.<domain>.
  app.get("/internal/tls", async (c) => {
    const domain = (c.req.query("domain") ?? "").toLowerCase();
    if (!DOMAIN || !domain.endsWith(`.${DOMAIN}`)) return c.text("no", 404);
    const sub = domain.slice(0, -DOMAIN.length - 1);
    if (sub === "api") return c.text("ok");
    if (!/^[a-z0-9-]{1,63}$/.test(sub)) return c.text("no", 404);
    return (await slugExists(sub)) ? c.text("ok") : c.text("no", 404);
  });

  const publishBody = z.object({ boardId: z.string().min(1).max(64), msg: z.object({ type: z.string() }).passthrough() });

  app.post("/internal/publish", async (c) => {
    if (!isLoopback(c) || !bearerOk(c.req.header("authorization"))) return c.json({ error: "Forbidden" }, 403);
    const parsed = publishBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Bad message" }, 400);
    publish(parsed.data.boardId, parsed.data.msg as unknown as StreamMsg);
    return c.json({ ok: true });
  });

  app.get("/internal/stats", async (c) => {
    if (!isLoopback(c) || !bearerOk(c.req.header("authorization"))) return c.json({ error: "Forbidden" }, 403);
    const [queue, nodes, tiers, beat] = await Promise.all([
      queueStats(),
      nodeStats(Date.now() - 3_600_000),
      all<{ tier: string; n: number }>(`SELECT tier, COUNT(*) AS n FROM boards GROUP BY tier`),
      latestWorkerHeartbeat().catch(() => null),
    ]);
    return c.json({
      queue,
      nodes,
      tiers: Object.fromEntries(tiers.map((t) => [t.tier, Number(t.n)])),
      sseConnections: sseState.connections,
      workerHeartbeat: beat,
    });
  });

  const userBody = z.object({
    email: z.string().email().max(320),
    name: z.string().max(255).nullable(),
    image: z.string().max(2000).nullable(),
  });

  app.post("/api/internal/users", async (c) => {
    if (!bearerOk(c.req.header("authorization"))) return c.json({ error: "Forbidden" }, 403);
    const parsed = userBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Bad user" }, 400);
    return c.json({ id: await upsertUser(parsed.data) });
  });

  const limitOf = (c: Context, d: number) => Math.min(Math.max(Number(c.req.query("limit") ?? d) || d, 1), 100);

  app.get("/api/boards", async (c) => c.json({ boards: await listBoards({ limit: limitOf(c, 50), publicOnly: true }) }));

  app.get("/api/me/boards", async (c) => {
    const user = await uid(c);
    if (!user) return c.json({ error: "Sign in to see your boards" }, 401);
    return c.json({ boards: await listBoards({ limit: limitOf(c, 50), ownerId: user }) });
  });

  const createBody = z.object({ prompt: z.string().trim().min(8).max(2000) });

  app.post("/api/boards", async (c) => {
    const user = await uid(c);
    if (!user) return c.json({ error: "Sign in to create a board" }, 401);
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Describe the crisis in at least a few words" }, 400);
    const [recent, active, queue] = await Promise.all([
      countRecentBoards(user, Date.now() - 3_600_000),
      countActiveBoards(user),
      queueStats(),
    ]);
    if (recent >= BOARDS_PER_HOUR) {
      return c.json({ error: "You have built a lot of boards in the last hour. Try again a bit later." }, 429);
    }
    if (active >= MAX_ACTIVE) {
      return c.json({ error: `You can keep ${MAX_ACTIVE} live boards at a time. Pause or delete one first.` }, 429);
    }
    if ((queue.queued.build ?? 0) > MAX_QUEUED_BUILDS) {
      return c.json({ error: "Faraday is busy building other boards. Try again in a few minutes." }, 503);
    }
    const { id, slug } = await createBoard(parsed.data.prompt, user);
    await enqueue("build", id, {});
    log("info", "board created", { boardId: id, slug });
    return c.json({ id, slug });
  });

  app.get("/api/boards/by-slug/:slug", async (c) => {
    const id = await boardIdForSlug(c.req.param("slug"));
    return sendView(c, id ? await view(id) : null);
  });

  app.get("/api/boards/:id", async (c) => sendView(c, await view(c.req.param("id"))));

  app.get("/api/boards/:id/runs/latest", async (c) => {
    const id = c.req.param("id");
    if (!(await getBoard(id))) return c.json({ error: "Not found" }, 404);
    return c.json(await latestRunView(id));
  });

  app.get("/api/boards/:id/stream", async (c) => {
    const id = c.req.param("id");
    const row = await getBoard(id);
    if (!row) return c.text("Not found", 404);
    const lastEventId = Number(c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? "");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      sseState.connections += 1;
      let chain: Promise<void> = Promise.resolve();
      let closed = false;
      let replayedUpTo = 0;
      const queued: StreamMsg[] = [];
      let replaying = true;

      const write = (msg: StreamMsg) => {
        if (closed) return;
        if (msg.type === "event" && msg.event.id <= replayedUpTo) return;
        const id = msg.type === "event" ? String(msg.event.id) : undefined;
        chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(msg), id })).catch(() => {});
      };
      const off = subscribe(id, (msg) => (replaying ? queued.push(msg) : write(msg)));

      const touch = () => {
        const now = Date.now();
        if (now - (sseState.touchedAt.get(id) ?? 0) < 60_000) return;
        sseState.touchedAt.set(id, now);
        void Promise.resolve().then(() => touchViewed(id, now)).catch(() => {});
      };
      touch();

      write({ type: "hello", version: row.version });
      if (Number.isFinite(lastEventId) && lastEventId > 0) {
        try {
          const missed = (await listEvents(id, { afterId: lastEventId, limit: 200 })).sort((a, b) => a.id - b.id);
          for (const event of missed) write({ type: "event", event });
          replayedUpTo = missed.length ? missed[missed.length - 1].id : lastEventId;
        } catch (e) {
          log("warn", "sse replay failed", { boardId: id, error: errMessage(e) });
        }
      }
      replaying = false;
      for (const m of queued.splice(0)) write(m);

      const ping = setInterval(() => {
        chain = chain.then(() => stream.write(": ping\n\n")).then(() => undefined).catch(() => {});
        touch();
      }, PING_MS);
      await new Promise<void>((resolve) =>
        stream.onAbort(() => {
          closed = true;
          off();
          clearInterval(ping);
          sseState.connections -= 1;
          if (subscriberCount(id) === 0) sseState.touchedAt.delete(id);
          resolve();
        }),
      );
    });
  });

  const editBody = z.object({ instruction: z.string().trim().min(3).max(1000) });

  app.post("/api/boards/:id/edit", async (c) => {
    const owned = await ownedBoard(c);
    if (owned instanceof Response) return owned;
    const parsed = editBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Write an instruction" }, 400);
    const id = owned.row.id;
    if (owned.row.specVersion < 2 || !owned.row.plan) return c.json({ error: "The board is still building" }, 409);
    if (await hasPendingJob(id, ["build", "edit"])) return c.json({ error: "The board is busy, try again in a moment" }, 409);
    const r = editsPerUser.hit(owned.uid);
    if (!r.ok) return c.json({ error: "That is a lot of edits for one hour. Try again later." }, 429);
    await addMessage(id, "user", parsed.data.instruction);
    await enqueue("edit", id, { instruction: parsed.data.instruction });
    await emitEvent(id, "edit", `Queued an edit: ${parsed.data.instruction}`);
    return c.json({ ok: true });
  });

  app.post("/api/boards/:id/refresh", async (c) => {
    const id = c.req.param("id");
    const [row, user] = await Promise.all([getBoard(id), uid(c)]);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.status !== "live") return c.json({ error: "The board is still building" }, 409);
    const byIp = refreshPerIp.hit(clientIp(c));
    if (!byIp.ok) {
      c.header("Retry-After", String(Math.ceil(byIp.retryAfterMs / 1000)));
      return c.json({ error: "Too many checks from here. Wait a minute." }, 429);
    }
    const byBoard = refreshPerBoard.hit(id);
    if (!byBoard.ok) {
      c.header("Retry-After", String(Math.ceil(byBoard.retryAfterMs / 1000)));
      return c.json({ error: "This board was just checked. Try again in a minute." }, 429);
    }
    const owner = !!user && user === row.ownerId;
    if (owner) void runBoardMonitors(id);
    await enqueue("poll", id, { reason: "manual" });
    return c.json({ ok: true, queued: true, monitors: owner });
  });

  app.post("/api/boards/:id/pause", async (c) => {
    const owned = await ownedBoard(c);
    if (owned instanceof Response) return owned;
    const id = owned.row.id;
    await setSchedule(id, { tier: "paused", nextPollAt: null });
    const removed = await removeBoardMonitors(id);
    publish(id, { type: "status", status: owned.row.status, tier: "paused" });
    await emitEvent(id, "info", "Paused by the owner. The board stops reading the web until it is resumed.", { monitorsRemoved: removed });
    return c.json({ ok: true, tier: "paused" });
  });

  app.post("/api/boards/:id/resume", async (c) => {
    const owned = await ownedBoard(c);
    if (owned instanceof Response) return owned;
    const id = owned.row.id;
    const now = Date.now();
    await setSchedule(id, { tier: "warm", nextPollAt: now });
    await enqueue("poll", id, { reason: "manual" });
    publish(id, { type: "status", status: owned.row.status, tier: "warm" });
    await emitEvent(id, "info", "Resumed. The board is reading the web again.");
    return c.json({ ok: true, tier: "warm" });
  });

  const visibilityBody = z.object({ visibility: z.enum(["public", "unlisted"]) });

  app.post("/api/boards/:id/visibility", async (c) => {
    const owned = await ownedBoard(c);
    if (owned instanceof Response) return owned;
    const parsed = visibilityBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "visibility must be public or unlisted" }, 400);
    await setVisibility(owned.row.id, parsed.data.visibility);
    cache.invalidate(owned.row.id);
    return c.json({ ok: true, visibility: parsed.data.visibility });
  });

  app.delete("/api/boards/:id", async (c) => {
    const owned = await ownedBoard(c);
    if (owned instanceof Response) return owned;
    const id = owned.row.id;
    await removeBoardMonitors(id);
    await deleteBoard(id);
    cache.invalidate(id);
    log("info", "board deleted", { boardId: id });
    return c.json({ ok: true });
  });

  app.post("/api/webhooks/context", async (c) => {
    const raw = await c.req.text();
    let payload: { monitor_id?: string; data?: { monitor_id?: string } } = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad json" }, 400);
    }
    const monitorId = payload.monitor_id ?? payload.data?.monitor_id;
    const monitor = monitorId ? await monitorById(monitorId) : undefined;
    if (!monitor) return c.json({ ok: true, ignored: true });
    // Each monitor has its own signing secret, issued when the webhook was attached.
    if (!monitor.webhookSecret || !verifySignature(raw, c.req.header("x-context-signature"), monitor.webhookSecret)) {
      return c.json({ error: "bad signature" }, 401);
    }
    await enqueue("poll", monitor.boardId, { reason: "webhook" });
    log("info", "webhook queued a poll", { boardId: monitor.boardId, monitorId });
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((err, c) => {
    log("error", "request failed", { method: c.req.method, path: c.req.path, error: errMessage(err) });
    return c.json({ error: "Internal error" }, 500);
  });

  return Object.assign(app, { dispose: unsubscribeCache, cache });
}
