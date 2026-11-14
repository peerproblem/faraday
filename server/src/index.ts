import { createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  boardIdForSlug,
  countRecentBoards,
  createBoard,
  getBoardView,
  getRow,
  listBoards,
  monitorById,
  slugExists,
} from "./boards";
import { subscribe } from "./bus";
import { buildBoard, editBoard, pollBoard, refreshBoard } from "./harness/run";
import { sessionUserId } from "./session";
import { upsertUser } from "./users";
import { startWorker } from "./worker";

const DOMAIN = process.env.FARADAY_DOMAIN ?? "";
const PORT = Number(process.env.ENGINE_PORT ?? 4000);
const HOST = process.env.ENGINE_HOST ?? "127.0.0.1";
const BOARDS_PER_HOUR = Number(process.env.BOARDS_PER_HOUR ?? 10);

function allowedOrigin(origin: string) {
  try {
    const u = new URL(origin);
    if (!DOMAIN) return u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" && (u.hostname === DOMAIN || u.hostname.endsWith(`.${DOMAIN}`));
  } catch {
    return false;
  }
}

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: (origin) => (origin && allowedOrigin(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 600,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
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

app.get("/api/boards", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
  return c.json({ boards: await listBoards(limit) });
});

const createBody = z.object({ prompt: z.string().trim().min(8).max(2000) });

app.post("/api/boards", async (c) => {
  const uid = await sessionUserId(c.req.header("cookie"));
  if (!uid) return c.json({ error: "Sign in to create a board" }, 401);
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Describe the crisis in at least a few words" }, 400);
  if ((await countRecentBoards(uid, Date.now() - 3_600_000)) >= BOARDS_PER_HOUR) {
    return c.json({ error: "You have built a lot of boards in the last hour. Try again a bit later." }, 429);
  }
  const { id, slug } = await createBoard(parsed.data.prompt, uid);
  buildBoard(id);
  return c.json({ id, slug });
});

app.get("/api/boards/by-slug/:slug", async (c) => {
  const id = await boardIdForSlug(c.req.param("slug"));
  const board = id ? await getBoardView(id) : null;
  return board ? c.json(board) : c.json({ error: "Not found" }, 404);
});

app.get("/api/boards/:id", async (c) => {
  const board = await getBoardView(c.req.param("id"));
  return board ? c.json(board) : c.json({ error: "Not found" }, 404);
});

app.get("/api/boards/:id/stream", async (c) => {
  const id = c.req.param("id");
  if (!(await getRow(id))) return c.text("Not found", 404);
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: "hello" }) });
    const off = subscribe(id, (msg) => void stream.writeSSE({ data: JSON.stringify(msg) }).catch(() => {}));
    const ping = setInterval(() => void stream.write(": ping\n\n").catch(() => {}), 20_000);
    await new Promise<void>((resolve) =>
      stream.onAbort(() => {
        off();
        clearInterval(ping);
        resolve();
      }),
    );
  });
});

const editBody = z.object({ instruction: z.string().trim().min(3).max(1000) });

app.post("/api/boards/:id/edit", async (c) => {
  const id = c.req.param("id");
  const [uid, row] = await Promise.all([sessionUserId(c.req.header("cookie")), getRow(id)]);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!uid || uid !== row.owner_id) return c.json({ error: "Only the owner can edit this board" }, 403);
  const parsed = editBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Write an instruction" }, 400);
  if (!editBoard(id, parsed.data.instruction)) return c.json({ error: "The board is busy, try again in a moment" }, 409);
  return c.json({ ok: true });
});

app.post("/api/boards/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const row = await getRow(id);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.status !== "live") return c.json({ error: "The board is still building" }, 409);
  return c.json(await refreshBoard(id));
});

function verifySignature(raw: string, header: string | undefined, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

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
  if (!monitor.webhook_secret || !verifySignature(raw, c.req.header("x-context-signature"), monitor.webhook_secret)) {
    return c.json({ error: "bad signature" }, 401);
  }
  void pollBoard(monitor.board_id, "manual").catch((e) => console.error("webhook poll failed", e));
  return c.json({ ok: true });
});

const userBody = z.object({
  email: z.string().email().max(320),
  name: z.string().max(255).nullable(),
  image: z.string().max(2000).nullable(),
});

function internalAuthorized(header: string | undefined) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post("/api/internal/users", async (c) => {
  if (!internalAuthorized(c.req.header("authorization"))) return c.json({ error: "Forbidden" }, 403);
  const parsed = userBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Bad user" }, 400);
  return c.json({ id: await upsertUser(parsed.data) });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[faraday] engine listening on http://${info.address}:${info.port}`);
});
startWorker();
