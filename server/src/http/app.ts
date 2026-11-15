import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { subscribe, subscribeAll, publish, subscriberCount } from "../bus";
import { publicSources } from "../pipeline/public-source";
import { one, all } from "../db/pool";
import { removeBoardMonitors, runBoardMonitors } from "../monitors";
import {
  addEvent,
  addMessage,
  boardIdForSlug,
  createBoard,
  deleteBoard,
  getBoard,
  getBoardView,
  listBoards,
  listEvents,
  listTopics,
  forgetWebhookEvent,
  monitorById,
  recordWebhookEvent,
  setSchedule,
  setVisibility,
  slugExists,
  touchViewed,
  type BoardRow,
} from "../repo/boards";
import { enqueue, hasPendingJob, queueStats } from "../repo/jobs";
import { discordConfig, handleInteraction, installUrl, verifyDiscord, type Interaction } from "../distribute/discord";
import { distributeEnabled } from "../distribute/run";
import { xCreds } from "../distribute/x-post";
import { recentPosts } from "../repo/distribution";
import {
  addTopicRequests,
  countViews,
  deleteView,
  getView,
  listCandidates,
  listTopicRequests,
  listViews,
  saveView,
  undoView,
} from "../repo/views";
import { latestRunView, latestWorkerHeartbeat, nodeStats } from "../repo/runs";
import { discoverEnabled, distributeLive, setDiscoverEnabled, setDistributeLive } from "../repo/settings";
import { listAdminTopics, setTopicState } from "../repo/topics";
import { sessionUserId } from "../session";
import { crisisTypes, emptyLayout, type BoardEvent, type BoardView, type MeView, type StreamMsg, type ViewEditResult, type ViewSaveResult } from "../spec";
import { getUser, isAdminEmail, upsertUser } from "../users";
import { defaultLayoutModel, editLayout, type LayoutModel } from "../views/edit-layout";
import { layoutInputSchema, sanitizeLayout } from "../views/sanitize";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, adminCookie, checkAdminLogin, issueAdminToken, readCookie, verifyAdminToken } from "./admin-auth";
import { errMessage, log } from "./log";
import { createLimiter } from "./rate-limit";
import { bearerOk, verifySignature } from "./signature";
import { createViewCache, etagFor, etagMatches } from "./view-cache";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export type AppOptions = {
  domain?: string;
  editsPerHour?: number;
  pingMs?: number;
  /** Prompt edits of a personal view per user per hour (VIEW_EDITS_PER_HOUR, default 30). */
  viewEditsPerHour?: number;
  /** Direct saves of a personal view per user per hour (VIEW_SAVES_PER_HOUR, default 120). */
  viewSavesPerHour?: number;
  /** Personal views per user (MAX_PERSONAL_VIEWS, default 20). */
  maxViews?: number;
  viewEditTimeoutMs?: number;
  layoutModel?: LayoutModel;
};

/** Tracks SSE connections and when each board was last recorded as viewed. */
export const sseState = { connections: 0, touchedAt: new Map<string, number>() };

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function createApp(opts: AppOptions = {}) {
  const DOMAIN = opts.domain ?? process.env.FARADAY_DOMAIN ?? "";
  const EDITS_PER_HOUR = opts.editsPerHour ?? num(process.env.EDITS_PER_HOUR, 20);
  const PING_MS = opts.pingMs ?? 20_000;
  const VIEW_EDITS_PER_HOUR = opts.viewEditsPerHour ?? num(process.env.VIEW_EDITS_PER_HOUR, 30);
  const VIEW_SAVES_PER_HOUR = opts.viewSavesPerHour ?? num(process.env.VIEW_SAVES_PER_HOUR, 120);
  const MAX_VIEWS = opts.maxViews ?? num(process.env.MAX_PERSONAL_VIEWS, 20);
  const VIEW_EDIT_TIMEOUT_MS = opts.viewEditTimeoutMs ?? 15_000;
  const layoutModel = opts.layoutModel ?? defaultLayoutModel;

  const refreshPerBoard = createLimiter({ windowMs: 60_000, max: 1 });
  const refreshPerIp = createLimiter({ windowMs: 60_000, max: 5 });
  const editsPerUser = createLimiter({ windowMs: 3_600_000, max: EDITS_PER_HOUR });
  const viewEditsPerUser = createLimiter({ windowMs: 3_600_000, max: VIEW_EDITS_PER_HOUR });
  const viewSavesPerUser = createLimiter({ windowMs: 3_600_000, max: VIEW_SAVES_PER_HOUR });
  const writesPerIp = createLimiter({ windowMs: 60_000, max: 60 });
  // Failed admin logins per IP. The password is short, so this is the main guard against guessing. A blocked address is
  // refused before its password is checked, so guessing on past the limit cannot reveal the right one.
  const LOGIN_WINDOW_MS = 15 * 60_000;
  const LOGIN_MAX_FAILURES = 5;
  const loginFailures = new Map<string, number[]>();
  const recentLoginFailures = (ip: string, now: number) => {
    const ts = (loginFailures.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (ts.length) loginFailures.set(ip, ts);
    else loginFailures.delete(ip);
    return ts;
  };
  const recordLoginFailure = (ip: string, now: number) => {
    if (loginFailures.size > 10_000) for (const k of [...loginFailures.keys()]) recentLoginFailures(k, now);
    loginFailures.set(ip, [...recentLoginFailures(ip, now), now]);
  };
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

  const hasAdminCookie = (c: Context) => verifyAdminToken(readCookie(c.req.header("cookie"), ADMIN_COOKIE));

  async function isAdminUser(user: string | null): Promise<boolean> {
    if (!user || !process.env.ADMIN_EMAILS) return false;
    const u = await getUser(user);
    return isAdminEmail(u?.email);
  }

  /** An admin is a valid /admin session cookie, or a signed-in user listed in ADMIN_EMAILS. */
  async function isAdmin(c: Context, user?: string | null): Promise<boolean> {
    if (hasAdminCookie(c)) return true;
    return isAdminUser(user === undefined ? await uid(c) : user);
  }

  /** Shared topics (origin system) are changed by admins only; legacy prompt boards by their owner. */
  async function ownedBoard(c: Context): Promise<{ row: BoardRow; uid: string } | Response> {
    const id = c.req.param("id") ?? "";
    const [user, row] = await Promise.all([uid(c), getBoard(id)]);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.origin === "system") {
      if (!(await isAdmin(c, user))) return c.json({ error: "Only an admin can change a shared topic" }, 403);
      // A password admin has no user id; "admin" keys the per-user edit limit.
      return { row, uid: user ?? "admin" };
    }
    if (!user || user !== row.ownerId) return c.json({ error: "Only the owner can change this board" }, 403);
    return { row, uid: user };
  }

  /** "admin" for a password session, else the admin user's id. 401 with no session at all, 403 for other users. */
  async function adminOnly(c: Context): Promise<string | Response> {
    if (hasAdminCookie(c)) return "admin";
    const user = await uid(c);
    if (!user) return c.json({ error: "Sign in first" }, 401);
    if (!(await isAdminUser(user))) return c.json({ error: "Admins only" }, 403);
    return user;
  }

  async function emitEvent(boardId: string, kind: BoardEvent["kind"], message: string, data: Record<string, unknown> | null = null) {
    const event = await addEvent(boardId, kind, message, data);
    publish(boardId, { type: "event", event });
    return event;
  }

  async function view(id: string): Promise<BoardView | null> {
    const cached = cache.get(id);
    if (cached) return cached;
    const stored = await getBoardView(id);
    // English only: non-English source titles and snippets never leave the server.
    const v = stored ? { ...stored, sources: publicSources(stored.sources) } : null;
    if (v) cache.set(id, v);
    return v;
  }

  /** The owner, the plan and the edit history are for admins (the studio); everyone else gets the board itself. */
  async function sendView(c: Context, v: BoardView | null) {
    if (!v) return c.json({ error: "Not found" }, 404);
    const etag = etagFor(v);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache");
    c.header("Vary", "Cookie");
    if (etagMatches(c.req.header("if-none-match"), etag)) return c.body(null, 304);
    if (await isAdmin(c)) return c.json(v);
    const out: BoardView = { ...v, ownerId: null, plan: null, messages: [] };
    return c.json(out);
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

  const topicStates = new Set(["active", "archived"]);

  app.get("/api/topics", async (c) => {
    const state = c.req.query("state") ?? "active";
    if (!topicStates.has(state)) return c.json({ error: "state must be active or archived" }, 400);
    const type = c.req.query("type") || null;
    if (type && !(crisisTypes as readonly string[]).includes(type)) return c.json({ error: "Unknown crisis type" }, 400);
    return c.json({ topics: await listTopics({ state: state as "active" | "archived", crisisType: type, limit: limitOf(c, 50) }) });
  });

  app.get("/api/boards/by-slug/:slug", async (c) => {
    const id = await boardIdForSlug(c.req.param("slug"));
    return sendView(c, id ? await view(id) : null);
  });

  app.get("/api/boards/:id", async (c) => sendView(c, await view(c.req.param("id"))));

  app.get("/api/boards/:id/runs/latest", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
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
      let ping: ReturnType<typeof setInterval> | undefined = undefined;
      let off: () => void = () => {};
      let finish: () => void = () => {};
      const finished = new Promise<void>((resolve) => (finish = resolve));
      // Runs once, whenever the viewer goes: also while the replay below is still waiting on the database (Hono does not
      // call abort listeners registered after the stream was aborted).
      const cleanup = () => {
        if (closed) return;
        closed = true;
        off();
        if (ping) clearInterval(ping);
        sseState.connections -= 1;
        if (subscriberCount(id) === 0) sseState.touchedAt.delete(id);
        finish();
      };
      stream.onAbort(cleanup);

      const write = (msg: StreamMsg) => {
        if (closed) return;
        if (msg.type === "event" && msg.event.id <= replayedUpTo) return;
        const id = msg.type === "event" ? String(msg.event.id) : undefined;
        const out: StreamMsg = msg.type === "sources" ? { ...msg, added: publicSources(msg.added) } : msg;
        // A named event lets tabs running an older client ignore poll metadata.
        const event = msg.type === "polled" ? "polled" : undefined;
        chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(out), id, event })).catch(() => {});
      };
      off = subscribe(id, (msg) => (replaying ? queued.push(msg) : write(msg)));
      if (stream.aborted) cleanup();

      const touch = () => {
        const now = Date.now();
        if (now - (sseState.touchedAt.get(id) ?? 0) < 60_000) return;
        sseState.touchedAt.set(id, now);
        void Promise.resolve().then(() => touchViewed(id, now)).catch(() => {});
      };
      touch();

      write({ type: "hello", version: row.version, lastPolledAt: row.lastPolledAt });
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
      if (stream.aborted) cleanup();
      if (closed) return;
      for (const m of queued.splice(0)) write(m);

      ping = setInterval(() => {
        chain = chain.then(() => stream.write(": ping\n\n")).then(() => undefined).catch(() => {});
        touch();
      }, PING_MS);
      await finished;
    });
  });

  app.get("/api/me", async (c) => {
    const user = await uid(c);
    if (!user) return c.json({ error: "Sign in first" }, 401);
    const u = await getUser(user);
    if (!u) return c.json({ error: "Sign in first" }, 401);
    const me: MeView = { id: u.id, email: u.email, name: u.name, image: u.image, isAdmin: isAdminEmail(u.email) || hasAdminCookie(c) };
    return c.json(me);
  });

  /** The signed-in user and the board for a /api/me/views/:boardId route. */
  async function viewTarget(c: Context): Promise<{ user: string; row: BoardRow } | Response> {
    const user = await uid(c);
    if (!user) return c.json({ error: "Sign in to use My dashboards" }, 401);
    const row = await getBoard(c.req.param("boardId") ?? "");
    if (!row) return c.json({ error: "Not found" }, 404);
    return { user, row };
  }

  const tooMany = (c: Context, retryAfterMs: number, error: string) => {
    c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return c.json({ error }, 429);
  };

  app.get("/api/me/views", async (c) => {
    const user = await uid(c);
    if (!user) return c.json({ error: "Sign in to use My dashboards" }, 401);
    return c.json({ views: await listViews(user, MAX_VIEWS) });
  });

  app.get("/api/me/views/:boardId", async (c) => {
    const t = await viewTarget(c);
    if (t instanceof Response) return t;
    const v = await getView(t.user, t.row.id);
    return c.json(v ? { layout: v.layout, rev: v.rev } : { layout: null, rev: 0 });
  });

  const saveBody = z.object({ layout: layoutInputSchema, rev: z.number().int().min(0) });

  app.post("/api/me/views/:boardId", async (c) => {
    const t = await viewTarget(c);
    if (t instanceof Response) return t;
    const parsed = saveBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "That layout is not valid" }, 400);
    if (!t.row.spec) return c.json({ error: "This topic is still being built" }, 409);
    if (parsed.data.rev === 0 && (await countViews(t.user)) >= MAX_VIEWS) {
      return c.json({ error: `You can keep ${MAX_VIEWS} dashboards. Remove one first.` }, 429);
    }
    const hit = viewSavesPerUser.hit(t.user);
    if (!hit.ok) return tooMany(c, hit.retryAfterMs, "That is a lot of changes for one hour. Try again later.");
    const layout = sanitizeLayout(parsed.data.layout, t.row.spec, t.row.plan);
    const r = await saveView(t.user, t.row.id, layout, parsed.data.rev);
    if (!r.ok) {
      return c.json({ error: "Your dashboard changed in another tab", layout: r.current?.layout ?? null, rev: r.current?.rev ?? 0 }, 409);
    }
    const out: ViewSaveResult = { layout, rev: r.rev };
    return c.json(out);
  });

  const viewEditBody = z.object({ instruction: z.string().trim().min(3).max(500) });

  app.post("/api/me/views/:boardId/edit", async (c) => {
    const t = await viewTarget(c);
    if (t instanceof Response) return t;
    const parsed = viewEditBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Describe the change in 3 to 500 characters" }, 400);
    if (!t.row.spec) return c.json({ error: "This topic is still being built" }, 409);
    const current = await getView(t.user, t.row.id);
    if (!current && (await countViews(t.user)) >= MAX_VIEWS) {
      return c.json({ error: `You can keep ${MAX_VIEWS} dashboards. Remove one first.` }, 429);
    }
    const hit = viewEditsPerUser.hit(t.user);
    if (!hit.ok) return tooMany(c, hit.retryAfterMs, "That is a lot of edits for one hour. Try again later.");
    const base = current?.layout ?? emptyLayout(t.row.version);
    let result;
    try {
      result = await editLayout(
        { spec: t.row.spec, plan: t.row.plan, layout: base, instruction: parsed.data.instruction, baseVersion: t.row.version },
        AbortSignal.timeout(VIEW_EDIT_TIMEOUT_MS),
        layoutModel,
      );
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      log("warn", "view edit failed", { boardId: t.row.id, error: errMessage(e) });
      return c.json({ error: timedOut ? "That took too long. Try again." : "Could not change the layout. Try again." }, timedOut ? 504 : 502);
    }
    const saved = await saveView(t.user, t.row.id, result.layout, current?.rev ?? 0, { instruction: parsed.data.instruction, reply: result.reply });
    if (!saved.ok) {
      return c.json({ error: "Your dashboard changed in another tab", layout: saved.current?.layout ?? null, rev: saved.current?.rev ?? 0 }, 409);
    }
    if (result.requests.length) await addTopicRequests(t.row.id, t.user, result.requests);
    const out: ViewEditResult = { layout: result.layout, rev: saved.rev, reply: result.reply, unsupported: result.unsupported };
    return c.json(out);
  });

  app.post("/api/me/views/:boardId/undo", async (c) => {
    const t = await viewTarget(c);
    if (t instanceof Response) return t;
    const r = await undoView(t.user, t.row.id);
    if (!r) return c.json({ error: "Nothing to undo" }, 404);
    // The restored layout may name widgets the baseline has since dropped.
    const out: ViewSaveResult = { layout: sanitizeLayout(r.layout, t.row.spec, t.row.plan), rev: r.rev };
    return c.json(out);
  });

  app.delete("/api/me/views/:boardId", async (c) => {
    const t = await viewTarget(c);
    if (t instanceof Response) return t;
    await deleteView(t.user, t.row.id);
    return c.json({ ok: true });
  });

  const loginBody = z.object({ username: z.string().max(200), password: z.string().max(200) });

  app.post("/api/admin/login", async (c) => {
    const ip = clientIp(c);
    const now = Date.now();
    const failures = recentLoginFailures(ip, now);
    if (failures.length >= LOGIN_MAX_FAILURES) {
      c.header("Retry-After", String(Math.ceil((LOGIN_WINDOW_MS - (now - failures[0])) / 1000)));
      return c.json({ error: "Too many failed attempts. Try again later." }, 429);
    }
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    const ok = parsed.success && checkAdminLogin(parsed.data.username, parsed.data.password);
    if (!ok) {
      recordLoginFailure(ip, now);
      log("warn", "admin login failed", { ip });
      return c.json({ error: "Wrong username or password" }, 401);
    }
    const token = issueAdminToken();
    if (!token) return c.json({ error: "Wrong username or password" }, 401);
    c.header("Set-Cookie", adminCookie(token, { domain: DOMAIN, maxAgeMs: ADMIN_SESSION_MS }));
    c.header("Cache-Control", "no-store");
    log("info", "admin signed in", { ip });
    return c.json({ admin: true });
  });

  app.post("/api/admin/logout", (c) => {
    c.header("Set-Cookie", adminCookie("", { domain: DOMAIN, maxAgeMs: 0 }));
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  });

  app.get("/api/admin/session", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ admin: await isAdmin(c) });
  });

  // distributeReady: the worker loop is on (DISTRIBUTE_ENABLED=1) and an X or Discord account is connected, so turning
  // distributeLive on really posts.
  const adminSettings = async () => ({
    discoverEnabled: await discoverEnabled(),
    distributeLive: await distributeLive(),
    distributeReady: distributeEnabled() && (xCreds() !== null || discordConfig() !== null),
  });

  app.get("/api/admin/settings", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    return c.json(await adminSettings());
  });

  const settingsBody = z
    .object({ discoverEnabled: z.boolean().optional(), distributeLive: z.boolean().optional() })
    .refine((b) => b.discoverEnabled !== undefined || b.distributeLive !== undefined);

  app.post("/api/admin/settings", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    const parsed = settingsBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Send discoverEnabled or distributeLive as true or false" }, 400);
    const by = admin === "admin" ? "password" : "email";
    const { discoverEnabled: discover, distributeLive: live } = parsed.data;
    if (discover !== undefined) {
      await setDiscoverEnabled(discover);
      log("info", "discovery setting changed", { discoverEnabled: discover, by });
    }
    if (live !== undefined) {
      await setDistributeLive(live);
      log("info", "distribution setting changed", { distributeLive: live, by });
    }
    return c.json(await adminSettings());
  });

  app.get("/api/admin/topics", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    return c.json({ topics: await listAdminTopics() });
  });

  const topicStateBody = z.object({ state: z.enum(["active", "archived"]) });

  app.post("/api/admin/topics/:id/state", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    const parsed = topicStateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "state must be active or archived" }, 400);
    const id = c.req.param("id");
    const now = Date.now();
    if (!(await setTopicState(id, parsed.data.state, now))) return c.json({ error: "Not found" }, 404);
    if (parsed.data.state === "active") {
      await enqueue("poll", id, { reason: "manual" });
    } else {
      await removeBoardMonitors(id);
    }
    const row = await getBoard(id);
    if (row) publish(id, { type: "status", status: row.status, tier: row.tier });
    cache.invalidate(id);
    return c.json({ ok: true });
  });

  const adminTopicBody = z.object({ prompt: z.string().trim().min(8).max(2000) });

  app.post("/api/admin/topics", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    const parsed = adminTopicBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Describe the crisis in at least a few words" }, 400);
    const { id, slug } = await createBoard(parsed.data.prompt, null, { origin: "system" });
    await enqueue("build", id, {});
    log("info", "topic created by an admin", { boardId: id, slug });
    return c.json({ id, slug });
  });

  // What the distributor posted (or would post, in a dry run), and which accounts are connected.
  app.get("/api/admin/distribution", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    return c.json({
      enabled: distributeEnabled(),
      dryRun: !(await distributeLive()),
      x: xCreds() !== null,
      discord: discordConfig() !== null,
      posts: await recentPosts(limitOf(c, 50)),
    });
  });

  app.get("/api/admin/candidates", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    return c.json({ candidates: await listCandidates(limitOf(c, 100)) });
  });

  const requestStatuses = new Set(["open", "accepted", "rejected"]);

  app.get("/api/admin/requests", async (c) => {
    const admin = await adminOnly(c);
    if (admin instanceof Response) return admin;
    const status = c.req.query("status") || null;
    if (status && !requestStatuses.has(status)) return c.json({ error: "status must be open, accepted or rejected" }, 400);
    return c.json({
      requests: await listTopicRequests({ boardId: c.req.query("boardId") || null, status: status as "open" | "accepted" | "rejected" | null, limit: limitOf(c, 100) }),
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
    if (row.tier === "paused" || (row.origin === "system" && row.topicState !== "active")) {
      return c.json({ error: "Live updates are paused for this board" }, 409);
    }
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
    // Running monitors now costs credits: legacy board owners and, for shared topics, admins only.
    const owner = row.origin === "system" ? await isAdmin(c, user) : !!user && user === row.ownerId;
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
    const who = owned.row.origin === "system" ? "an admin" : "the owner";
    await emitEvent(id, "info", `Paused by ${who}. The board stops reading the web until it is resumed.`, { monitorsRemoved: removed });
    return c.json({ ok: true, tier: "paused" });
  });

  app.post("/api/boards/:id/resume", async (c) => {
    const owned = await ownedBoard(c);
    if (owned instanceof Response) return owned;
    const id = owned.row.id;
    const now = Date.now();
    // A paused shared topic may have been archived by topic upkeep meanwhile: resuming makes it active again.
    if (owned.row.origin === "system") {
      await setTopicState(id, "active", now);
      cache.invalidate(id);
    } else await setSchedule(id, { tier: "warm", nextPollAt: now });
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
    // Open tabs learn the board is gone before the rows stop answering.
    await emitEvent(id, "info", "This board was deleted.").catch(() => {});
    publish(id, { type: "status", status: "error", tier: "paused" });
    await deleteBoard(id);
    cache.invalidate(id);
    log("info", "board deleted", { boardId: id });
    return c.json({ ok: true });
  });

  // Context.dev monitor webhook. Body: { event, id, created_at, data: { change } } for change.detected (run.completed has
  // data.run and data.change). `id` (also X-Context-Id) is stable across retries and replays: it is the dedupe key.
  app.post("/api/webhooks/context", async (c) => {
    const raw = await c.req.text();
    type Body = {
      id?: string;
      event?: string;
      monitor_id?: string;
      data?: { monitor_id?: string; change?: { monitor_id?: string } | null; run?: { monitor_id?: string } | null };
    };
    let payload: Body = {};
    try {
      payload = JSON.parse(raw) ?? {};
    } catch {
      return c.json({ error: "bad json" }, 400);
    }
    const monitorId = payload.data?.change?.monitor_id ?? payload.data?.run?.monitor_id ?? payload.data?.monitor_id ?? payload.monitor_id;
    const monitor = monitorId ? await monitorById(monitorId) : undefined;
    if (!monitor || monitor.remoteStatus === "dead") return c.json({ ok: true, ignored: true });
    // Each monitor has its own signing secret, issued when the webhook was attached.
    if (!monitor.webhookSecret || !verifySignature(raw, c.req.header("x-context-signature"), monitor.webhookSecret)) {
      return c.json({ error: "bad signature" }, 401);
    }
    const headerId = c.req.header("x-context-id");
    if (headerId && payload.id && headerId !== payload.id) return c.json({ error: "event id mismatch" }, 400);
    const eventId = payload.id ?? headerId ?? null;
    const event = payload.event ?? c.req.header("x-context-event") ?? "change.detected";
    // Only change.detected is subscribed; anything else is acknowledged so it is not retried.
    if (event !== "change.detected") return c.json({ ok: true, ignored: true });
    if (eventId && !(await recordWebhookEvent({ eventId, monitorId: monitor.id, event }))) {
      log("info", "webhook duplicate", { boardId: monitor.boardId, monitorId, eventId });
      return c.json({ ok: true, duplicate: true });
    }
    try {
      await enqueue("poll", monitor.boardId, { reason: "webhook" });
    } catch (e) {
      // Not queued: forget the id so Context.dev's retry is not taken for a duplicate.
      if (eventId) await forgetWebhookEvent(eventId).catch(() => {});
      throw e;
    }
    log("info", "webhook queued a poll", { boardId: monitor.boardId, monitorId, eventId });
    return c.json({ ok: true });
  });

  // Discord slash commands (/follow, /unfollow, /following, /topics). Discord signs every request with Ed25519 and
  // checks on setup that an unsigned one is refused.
  app.post("/api/webhooks/discord", async (c) => {
    const cfg = discordConfig();
    if (!cfg) return c.json({ error: "Discord is not configured" }, 404);
    const raw = await c.req.text();
    if (!verifyDiscord(raw, c.req.header("x-signature-ed25519"), c.req.header("x-signature-timestamp"), cfg.publicKey)) {
      return c.json({ error: "bad signature" }, 401);
    }
    let interaction: Interaction;
    try {
      interaction = JSON.parse(raw) as Interaction;
    } catch {
      return c.json({ error: "bad json" }, 400);
    }
    return c.json(await handleInteraction(interaction, DOMAIN));
  });

  // A short link to add the Faraday bot to a Discord server.
  app.get("/api/discord/install", (c) => {
    const cfg = discordConfig();
    return cfg ? c.redirect(installUrl(cfg.applicationId)) : c.json({ error: "Discord is not configured" }, 404);
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((err, c) => {
    log("error", "request failed", { method: c.req.method, path: c.req.path, error: errMessage(err) });
    return c.json({ error: "Internal error" }, 500);
  });

  return Object.assign(app, { dispose: unsubscribeCache, cache });
}
