import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, BoardView } from "../spec";

const boards = vi.hoisted(() => ({
  addEvent: vi.fn(),
  addMessage: vi.fn(),
  boardIdForSlug: vi.fn(),
  countActiveBoards: vi.fn(),
  countRecentBoards: vi.fn(),
  createBoard: vi.fn(),
  deleteBoard: vi.fn(),
  getBoard: vi.fn(),
  getBoardView: vi.fn(),
  listBoards: vi.fn(),
  listEvents: vi.fn(),
  monitorById: vi.fn(),
  recordWebhookEvent: vi.fn(async () => true),
  forgetWebhookEvent: vi.fn(),
  setSchedule: vi.fn(),
  setVisibility: vi.fn(),
  slugExists: vi.fn(),
  touchViewed: vi.fn(),
}));
const jobs = vi.hoisted(() => ({ enqueue: vi.fn(), hasPendingJob: vi.fn(), queueStats: vi.fn() }));
const runs = vi.hoisted(() => ({ latestRunView: vi.fn(), latestWorkerHeartbeat: vi.fn(), nodeStats: vi.fn() }));
const monitors = vi.hoisted(() => ({ removeBoardMonitors: vi.fn(), runBoardMonitors: vi.fn() }));
const session = vi.hoisted(() => ({ sessionUserId: vi.fn() }));
const conn = vi.hoisted(() => ({ address: "203.0.113.9" }));

vi.mock("../repo/boards", () => boards);
vi.mock("../repo/jobs", () => jobs);
vi.mock("../repo/runs", () => runs);
vi.mock("../monitors", () => monitors);
vi.mock("../session", () => session);
vi.mock("../users", () => ({ upsertUser: vi.fn(async () => "u-new") }));
vi.mock("../db/pool", () => ({ one: vi.fn(async () => ({ ok: 1 })), all: vi.fn(async () => []) }));
vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo: () => ({ remote: { address: conn.address } }) }));

const { createApp } = await import("./app");
const { publish } = await import("../bus");
const { sign } = await import("./signature");

const row = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  slug: "flood-abc12",
  ownerId: "u1",
  status: "live",
  tier: "hot",
  version: 3,
  specVersion: 2,
  plan: { title: "Flood" },
  ...over,
});

const view = (over: Partial<BoardView> = {}): BoardView =>
  ({ id: "b1", slug: "flood-abc12", version: 3, status: "live", tier: "hot", sources: [], events: [], ...over }) as BoardView;

const ev = (id: number): BoardEvent => ({ id, ts: id, kind: "info", message: `e${id}`, data: null });

beforeEach(() => {
  vi.clearAllMocks();
  conn.address = "203.0.113.9";
  session.sessionUserId.mockResolvedValue(null);
  jobs.queueStats.mockResolvedValue({ queued: { build: 0, edit: 0, poll: 0, cleanup: 0 }, running: 0, failedLastHour: 0 });
  jobs.hasPendingJob.mockResolvedValue(false);
  jobs.enqueue.mockResolvedValue(1);
  boards.addEvent.mockImplementation(async (_b: string, kind: string, message: string) => ({ id: 99, ts: 1, kind, message, data: null }));
  monitors.removeBoardMonitors.mockResolvedValue(1);
  monitors.runBoardMonitors.mockResolvedValue(undefined);
});

describe("board views", () => {
  it("sends an ETag and answers 304 when it matches", async () => {
    const app = createApp({ domain: "faraday.watch" });
    boards.getBoardView.mockResolvedValue(view());
    const first = await app.request("/api/boards/b1");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toBe('"v3-live-hot"');
    const second = await app.request("/api/boards/b1", { headers: { "If-None-Match": etag } });
    expect(second.status).toBe(304);
    // Served from the 5 second cache.
    expect(boards.getBoardView).toHaveBeenCalledTimes(1);
    app.dispose();
  });

  it("drops the cached view when the board publishes", async () => {
    const app = createApp();
    boards.getBoardView.mockResolvedValueOnce(view()).mockResolvedValueOnce(view({ version: 4 }));
    await app.request("/api/boards/b1");
    publish("b1", { type: "status", status: "live", tier: "hot" });
    const r = await app.request("/api/boards/b1", { headers: { "If-None-Match": '"v3-live-hot"' } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as BoardView).version).toBe(4);
    app.dispose();
  });

  it("404s an unknown slug", async () => {
    const app = createApp();
    boards.boardIdForSlug.mockResolvedValue(null);
    expect((await app.request("/api/boards/by-slug/nope")).status).toBe(404);
    app.dispose();
  });
});

describe("POST /api/boards", () => {
  const post = (app: ReturnType<typeof createApp>) =>
    app.request("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Floods in Valencia now" }) });

  it("needs a session", async () => {
    const app = createApp();
    expect((await post(app)).status).toBe(401);
    app.dispose();
  });

  it("enforces the hourly limit, the active board limit and the global queue", async () => {
    const app = createApp({ boardsPerHour: 2, maxActiveBoards: 5, maxQueuedBuilds: 20 });
    session.sessionUserId.mockResolvedValue("u1");
    boards.countRecentBoards.mockResolvedValue(2);
    boards.countActiveBoards.mockResolvedValue(0);
    expect((await post(app)).status).toBe(429);
    boards.countRecentBoards.mockResolvedValue(0);
    boards.countActiveBoards.mockResolvedValue(5);
    expect((await post(app)).status).toBe(429);
    boards.countActiveBoards.mockResolvedValue(0);
    jobs.queueStats.mockResolvedValue({ queued: { build: 21, edit: 0, poll: 0, cleanup: 0 }, running: 0, failedLastHour: 0 });
    expect((await post(app)).status).toBe(503);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    app.dispose();
  });

  it("creates the board and queues a build", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    boards.countRecentBoards.mockResolvedValue(0);
    boards.countActiveBoards.mockResolvedValue(0);
    boards.createBoard.mockResolvedValue({ id: "b9", slug: "s9" });
    const r = await post(app);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: "b9", slug: "s9" });
    expect(jobs.enqueue).toHaveBeenCalledWith("build", "b9", {});
    app.dispose();
  });
});

describe("refresh", () => {
  it("allows one check per board per minute and only runs monitors for the owner", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    const r1 = await app.request("/api/boards/b1/refresh", { method: "POST" });
    expect(r1.status).toBe(200);
    expect(monitors.runBoardMonitors).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith("poll", "b1", { reason: "manual" });
    const r2 = await app.request("/api/boards/b1/refresh", { method: "POST" });
    expect(r2.status).toBe(429);
    expect(r2.headers.get("retry-after")).toBeTruthy();
    app.dispose();
  });

  it("limits one address to 5 checks a minute across boards", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockImplementation(async (id: string) => row({ id }));
    for (let i = 0; i < 5; i++) expect((await app.request(`/api/boards/x${i}/refresh`, { method: "POST" })).status).toBe(200);
    expect(monitors.runBoardMonitors).toHaveBeenCalledTimes(5);
    expect((await app.request("/api/boards/x9/refresh", { method: "POST" })).status).toBe(429);
    app.dispose();
  });

  it("refuses boards that are still building", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row({ status: "composing" }));
    expect((await app.request("/api/boards/b1/refresh", { method: "POST" })).status).toBe(409);
    app.dispose();
  });
});

describe("owner actions", () => {
  it("refuses non-owners", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    session.sessionUserId.mockResolvedValue("u2");
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(403);
    expect((await app.request("/api/boards/b1", { method: "DELETE" })).status).toBe(403);
    expect(boards.deleteBoard).not.toHaveBeenCalled();
    app.dispose();
  });

  it("pauses (removing monitors) and resumes (queueing a poll)", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(200);
    expect(boards.setSchedule).toHaveBeenCalledWith("b1", { tier: "paused", nextPollAt: null });
    expect(monitors.removeBoardMonitors).toHaveBeenCalledWith("b1");
    expect((await app.request("/api/boards/b1/resume", { method: "POST" })).status).toBe(200);
    expect(boards.setSchedule).toHaveBeenLastCalledWith("b1", expect.objectContaining({ tier: "warm" }));
    expect(jobs.enqueue).toHaveBeenCalledWith("poll", "b1", { reason: "manual" });
    app.dispose();
  });

  it("queues an edit, and refuses it while a build or edit is pending", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    session.sessionUserId.mockResolvedValue("u1");
    const edit = () =>
      app.request("/api/boards/b1/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: "Add road closures" }) });
    expect((await edit()).status).toBe(200);
    expect(boards.addMessage).toHaveBeenCalledWith("b1", "user", "Add road closures");
    expect(jobs.enqueue).toHaveBeenCalledWith("edit", "b1", { instruction: "Add road closures" });
    jobs.hasPendingJob.mockResolvedValue(true);
    expect((await edit()).status).toBe(409);
    app.dispose();
  });

  it("deletes the board and its monitors", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/boards/b1", { method: "DELETE" })).status).toBe(200);
    expect(monitors.removeBoardMonitors).toHaveBeenCalledWith("b1");
    expect(boards.deleteBoard).toHaveBeenCalledWith("b1");
    app.dispose();
  });
});

describe("webhook", () => {
  const monitor = { id: "m1", boardId: "b1", kind: "search", target: "q", lastSeenChangeAt: null, webhookSecret: "whsec", remoteStatus: "active" };
  // The envelope Context.dev sends: the monitor id is inside data.change.
  const body = JSON.stringify({ event: "change.detected", id: "evt_1", created_at: "2026-11-14T10:00:00Z", data: { change: { id: "chg_1", monitor_id: "m1" } } });
  const post = (app: ReturnType<typeof createApp>, raw: string, secret: string, headers: Record<string, string> = {}) =>
    app.request("/api/webhooks/context", { method: "POST", body: raw, headers: { "x-context-signature": sign(raw, secret), ...headers } });

  it("queues a poll only for a correctly signed body", async () => {
    const app = createApp();
    boards.monitorById.mockResolvedValue(monitor);
    expect((await post(app, body, "nope")).status).toBe(401);
    const good = await post(app, body, "whsec", { "x-context-id": "evt_1", "x-context-event": "change.detected" });
    expect(good.status).toBe(200);
    expect(boards.monitorById).toHaveBeenCalledWith("m1");
    expect(boards.recordWebhookEvent).toHaveBeenCalledWith({ eventId: "evt_1", monitorId: "m1", event: "change.detected" });
    expect(jobs.enqueue).toHaveBeenCalledWith("poll", "b1", { reason: "webhook" });
    app.dispose();
  });

  it("acknowledges a retried event without queueing again", async () => {
    const app = createApp();
    boards.monitorById.mockResolvedValue(monitor);
    boards.recordWebhookEvent.mockResolvedValueOnce(false);
    const res = await post(app, body, "whsec");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    app.dispose();
  });

  it("forgets the event id when the poll cannot be queued, so the retry is accepted", async () => {
    const app = createApp();
    boards.monitorById.mockResolvedValue(monitor);
    jobs.enqueue.mockRejectedValueOnce(new Error("db down"));
    expect((await post(app, body, "whsec")).status).toBe(500);
    expect(boards.forgetWebhookEvent).toHaveBeenCalledWith("evt_1");
    app.dispose();
  });

  it("rejects a header id that does not match the body and ignores other events", async () => {
    const app = createApp();
    boards.monitorById.mockResolvedValue(monitor);
    expect((await post(app, body, "whsec", { "x-context-id": "evt_2" })).status).toBe(400);
    const run = JSON.stringify({ event: "run.completed", id: "evt_3", data: { run: { monitor_id: "m1" }, change: null } });
    expect(await (await post(app, run, "whsec")).json()).toMatchObject({ ignored: true });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    app.dispose();
  });
});

describe("internal endpoints", () => {
  it("accept only loopback callers with the internal key", async () => {
    process.env.INTERNAL_API_KEY = "ik";
    const app = createApp();
    const msg = JSON.stringify({ boardId: "b1", msg: { type: "hello", version: 1 } });
    const auth = { Authorization: "Bearer ik", "Content-Type": "application/json" };
    expect((await app.request("/internal/publish", { method: "POST", body: msg, headers: auth })).status).toBe(403);
    conn.address = "127.0.0.1";
    expect((await app.request("/internal/publish", { method: "POST", body: msg, headers: { "Content-Type": "application/json" } })).status).toBe(403);
    expect((await app.request("/internal/publish", { method: "POST", body: msg, headers: auth })).status).toBe(200);
    app.dispose();
  });

  it("health reports a missing worker heartbeat as degraded", async () => {
    const app = createApp();
    runs.latestWorkerHeartbeat.mockResolvedValue(Date.now() - 10 * 60_000);
    expect(await (await app.request("/health")).json()).toMatchObject({ ok: true, degraded: true });
    runs.latestWorkerHeartbeat.mockResolvedValue(Date.now());
    expect(await (await app.request("/health")).json()).toEqual({ ok: true, worker: expect.any(Number) });
    app.dispose();
  });

  it("tls answers only for existing board hosts and api", async () => {
    const app = createApp({ domain: "faraday.watch" });
    boards.slugExists.mockImplementation(async (s: string) => s === "flood-abc12");
    expect((await app.request("/internal/tls?domain=flood-abc12.faraday.watch")).status).toBe(200);
    expect((await app.request("/internal/tls?domain=api.faraday.watch")).status).toBe(200);
    expect((await app.request("/internal/tls?domain=nope.faraday.watch")).status).toBe(404);
    expect((await app.request("/internal/tls?domain=evil.example.com")).status).toBe(404);
    app.dispose();
  });
});

describe("SSE stream", () => {
  async function readUntil(res: Response, done: (text: string) => boolean) {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 3_000;
    while (!done(text) && Date.now() < deadline) {
      const { value, done: end } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 200)),
      ]);
      if (value) text += dec.decode(value);
      if (end && !value) await new Promise((r) => setTimeout(r, 10));
    }
    await reader.cancel().catch(() => {});
    return text;
  }

  it("sends hello, replays events after Last-Event-ID with ids, then live messages", async () => {
    const app = createApp({ pingMs: 60_000 });
    boards.getBoard.mockResolvedValue(row());
    boards.listEvents.mockResolvedValue([ev(12), ev(11)]);
    const res = await app.request("/api/boards/b1/stream", { headers: { "Last-Event-ID": "10" } });
    expect(res.status).toBe(200);
    setTimeout(() => {
      publish("b1", { type: "event", event: ev(12) });
      publish("b1", { type: "event", event: ev(13) });
    }, 50);
    const text = await readUntil(res, (t) => t.includes('"e13"'));
    expect(boards.listEvents).toHaveBeenCalledWith("b1", { afterId: 10, limit: 200 });
    const frames = text.split("\n\n").filter((f) => f.includes("data:"));
    const parsed = frames.map((f) => ({
      id: /^id: ?(.*)$/m.exec(f)?.[1] ?? null,
      msg: JSON.parse(/^data: ?(.*)$/m.exec(f)![1]) as { type: string; version?: number; event?: BoardEvent },
    }));
    expect(parsed[0].msg).toEqual({ type: "hello", version: 3 });
    const events = parsed.filter((p) => p.msg.type === "event");
    // 11 and 12 replayed in order, the live duplicate of 12 is skipped, 13 arrives live.
    expect(events.map((e) => [e.id, e.msg.event!.message])).toEqual([
      ["11", "e11"],
      ["12", "e12"],
      ["13", "e13"],
    ]);
    expect(boards.touchViewed).toHaveBeenCalledWith("b1", expect.any(Number));
    app.dispose();
  });

  it("404s for an unknown board", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(null);
    expect((await app.request("/api/boards/zz/stream")).status).toBe(404);
    app.dispose();
  });
});
