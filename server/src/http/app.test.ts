import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, BoardView } from "../spec";

const boards = vi.hoisted(() => ({
  addEvent: vi.fn(),
  addMessage: vi.fn(),
  boardIdForSlug: vi.fn(),
  createBoard: vi.fn(),
  deleteBoard: vi.fn(),
  getBoard: vi.fn(),
  getBoardView: vi.fn(),
  listBoards: vi.fn(),
  listEvents: vi.fn(),
  listTopics: vi.fn(async () => []),
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
const views = vi.hoisted(() => ({
  addTopicRequests: vi.fn(),
  countViews: vi.fn(async () => 0),
  deleteView: vi.fn(),
  getView: vi.fn(),
  listCandidates: vi.fn(async () => []),
  listTopicRequests: vi.fn(async () => []),
  listViews: vi.fn(async () => []),
  saveView: vi.fn(),
  undoView: vi.fn(),
}));
const users = vi.hoisted(() => ({ upsertUser: vi.fn(async () => "u-new"), getUser: vi.fn() }));
const conn = vi.hoisted(() => ({ address: "203.0.113.9" }));
const settings = vi.hoisted(() => ({ discoverEnabled: vi.fn(async () => false), setDiscoverEnabled: vi.fn(async () => {}) }));
const topicsRepo = vi.hoisted(() => ({ listAdminTopics: vi.fn(async () => []), setTopicState: vi.fn(async () => true) }));

vi.mock("../repo/boards", () => boards);
vi.mock("../repo/jobs", () => jobs);
vi.mock("../repo/runs", () => runs);
vi.mock("../monitors", () => monitors);
vi.mock("../session", () => session);
vi.mock("../repo/views", () => views);
vi.mock("../repo/settings", () => settings);
vi.mock("../repo/topics", () => topicsRepo);
vi.mock("../users", async (orig) => ({ ...(await orig<typeof import("../users")>()), ...users }));
vi.mock("../db/pool", () => ({ one: vi.fn(async () => ({ ok: 1 })), all: vi.fn(async () => []) }));
vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo: () => ({ remote: { address: conn.address } }) }));

const { createApp, sseState } = await import("./app");
const { publish } = await import("../bus");
const { sign } = await import("./signature");
const { issueAdminToken } = await import("./admin-auth");

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
  process.env.ADMIN_EMAILS = "Admin@Example.com, other@example.com";
  users.getUser.mockImplementation(async (id: string) =>
    id === "admin" ? { id, email: "admin@example.com", name: "A", image: null } : { id, email: `${id}@example.com`, name: null, image: null },
  );
  views.getView.mockResolvedValue(null);
  views.countViews.mockResolvedValue(0);
  views.saveView.mockImplementation(async (_u: string, _b: string, _l: unknown, rev: number) => ({ ok: true, rev: rev + 1 }));
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

  it("hides the owner, plan and edit history from everyone but admins", async () => {
    const app = createApp();
    const full = view({ ownerId: "u1", plan: { title: "Flood" } as BoardView["plan"], messages: [{ role: "user", content: "secret", ts: 1 }] });
    boards.getBoardView.mockResolvedValue(full);
    boards.boardIdForSlug.mockResolvedValue("b1");
    for (const path of ["/api/boards/b1", "/api/boards/by-slug/flood-abc12"]) {
      const r = await app.request(path);
      expect(r.headers.get("vary")).toContain("Cookie");
      const body = (await r.json()) as BoardView;
      expect(body.ownerId).toBeNull();
      expect(body.plan).toBeNull();
      expect(body.messages).toEqual([]);
    }
    session.sessionUserId.mockResolvedValue("admin");
    const admin = (await (await app.request("/api/boards/b1")).json()) as BoardView;
    expect(admin.ownerId).toBe("u1");
    expect(admin.messages).toHaveLength(1);
    app.dispose();
  });

  it("serves the latest run to admins only", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    runs.latestRunView.mockResolvedValue({ run: null, steps: [], totals: {} });
    expect((await app.request("/api/boards/b1/runs/latest")).status).toBe(401);
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/boards/b1/runs/latest")).status).toBe(403);
    session.sessionUserId.mockResolvedValue("admin");
    expect((await app.request("/api/boards/b1/runs/latest")).status).toBe(200);
    app.dispose();
  });

  it("404s an unknown slug", async () => {
    const app = createApp();
    boards.boardIdForSlug.mockResolvedValue(null);
    expect((await app.request("/api/boards/by-slug/nope")).status).toBe(404);
    app.dispose();
  });
});

const spec = {
  version: 2,
  widgets: [
    { id: "w1", key: "narrative", type: "narrative", title: "Now", span: "full", bind: null, metrics: [] },
    { id: "w2", key: "stat-grid", type: "stat-grid", title: "Figures", span: "full", bind: null, metrics: ["deaths", "evacuated"] },
    { id: "w3", key: "map", type: "map", title: "Map", span: "full", bind: null, metrics: [] },
    { id: "w4", key: "table:shelters", type: "table", title: "Shelters", span: "full", bind: "shelters", metrics: [] },
  ],
};
const plan = { title: "Flood", metrics: [{ key: "deaths", label: "Deaths" }, { key: "evacuated", label: "Evacuated" }], tables: [] };
const topic = (over: Record<string, unknown> = {}) => row({ origin: "system", topicState: "active", ownerId: null, spec, plan, ...over });
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("removed prompt boards", () => {
  it("has no POST /api/boards", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    const r = await app.request("/api/boards", json({ prompt: "Floods in Valencia now" }));
    expect(r.status).toBe(404);
    expect(boards.createBoard).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    app.dispose();
  });
});

describe("GET /api/topics", () => {
  it("lists active topics by default and validates state and type", async () => {
    const app = createApp();
    boards.listTopics.mockResolvedValue([{ id: "b1" }] as never);
    const r = await app.request("/api/topics?type=flood&limit=5");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ topics: [{ id: "b1" }] });
    expect(boards.listTopics).toHaveBeenCalledWith({ state: "active", crisisType: "flood", limit: 5 });
    expect((await app.request("/api/topics?state=archived")).status).toBe(200);
    expect(boards.listTopics).toHaveBeenLastCalledWith({ state: "archived", crisisType: null, limit: 50 });
    expect((await app.request("/api/topics?state=merged")).status).toBe(400);
    expect((await app.request("/api/topics?type=volcano")).status).toBe(400);
    app.dispose();
  });
});

describe("GET /api/me", () => {
  it("needs a session and reports admins from ADMIN_EMAILS, case-insensitively", async () => {
    const app = createApp();
    expect((await app.request("/api/me")).status).toBe(401);
    session.sessionUserId.mockResolvedValue("admin");
    expect(await (await app.request("/api/me")).json()).toEqual({ id: "admin", email: "admin@example.com", name: "A", image: null, isAdmin: true });
    session.sessionUserId.mockResolvedValue("u1");
    expect((await (await app.request("/api/me")).json()).isAdmin).toBe(false);
    app.dispose();
  });
});

describe("personal views", () => {
  it("needs a session on every /api/me/views route", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(topic());
    for (const [path, init] of [
      ["/api/me/views", undefined],
      ["/api/me/views/b1", undefined],
      ["/api/me/views/b1", json({ layout: {}, rev: 0 })],
      ["/api/me/views/b1/edit", json({ instruction: "Map bigger" })],
      ["/api/me/views/b1/undo", { method: "POST" }],
      ["/api/me/views/b1", { method: "DELETE" }],
    ] as const) {
      expect((await app.request(path, init)).status, path).toBe(401);
    }
    app.dispose();
  });

  it("returns an empty state when there is no view, 404 for an unknown board", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic());
    expect(await (await app.request("/api/me/views/b1")).json()).toEqual({ layout: null, rev: 0 });
    boards.getBoard.mockResolvedValue(null);
    expect((await app.request("/api/me/views/zz")).status).toBe(404);
    app.dispose();
  });

  it("sanitizes and saves a layout, and answers 409 with the stored view on a stale rev", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic());
    const layout = { order: ["map", "ghost"], hidden: [], size: { map: "half" }, pinned: [], filters: {}, extras: [], header: { compact: false }, baseVersion: 3 };
    const r = await app.request("/api/me/views/b1", json({ layout, rev: 0 }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.rev).toBe(1);
    expect(body.layout.order).toEqual(["map"]);
    expect(views.saveView).toHaveBeenCalledWith("u1", "b1", expect.objectContaining({ order: ["map"], size: { map: "half" } }), 0);

    const stored = { layout: { ...layout, order: ["narrative"] }, rev: 4 };
    views.saveView.mockResolvedValueOnce({ ok: false, current: stored });
    const conflict = await app.request("/api/me/views/b1", json({ layout, rev: 2 }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual(expect.objectContaining({ layout: stored.layout, rev: 4 }));
    expect((await app.request("/api/me/views/b1", json({ layout: "nope", rev: 0 }))).status).toBe(400);
    app.dispose();
  });

  it("caps views per user and saves per hour", async () => {
    const app = createApp({ maxViews: 2, viewSavesPerHour: 2 });
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic());
    views.countViews.mockResolvedValue(2);
    expect((await app.request("/api/me/views/b1", json({ layout: {}, rev: 0 }))).status).toBe(429);
    views.countViews.mockResolvedValue(0);
    expect((await app.request("/api/me/views/b1", json({ layout: {}, rev: 1 }))).status).toBe(200);
    expect((await app.request("/api/me/views/b1", json({ layout: {}, rev: 2 }))).status).toBe(200);
    const r = await app.request("/api/me/views/b1", json({ layout: {}, rev: 3 }));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    app.dispose();
  });

  it("edits by prompt with the injected model, stores unsupported parts as requests and limits edits per hour", async () => {
    const layoutModel = vi.fn(async () => ({
      reply: "Moved the map to the top.",
      order: ["map", "ghost"],
      hidden: [],
      size: [{ key: "map", span: "full" as const }],
      pinned: [],
      filters: [],
      extras: [],
      compactHeader: false,
      unsupported: ["shelter capacity"],
    }));
    const app = createApp({ layoutModel, viewEditsPerHour: 1 });
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic());
    const r = await app.request("/api/me/views/b1/edit", json({ instruction: "Map first, and shelter capacity" }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.layout.order).toEqual(["map"]);
    expect(body.rev).toBe(1);
    expect(body.unsupported).toEqual(["shelter capacity"]);
    expect(body.reply).toBe("Moved the map to the top. This topic doesn't track shelter capacity yet. I left a request.");
    expect(views.addTopicRequests).toHaveBeenCalledWith("b1", "u1", ["shelter capacity"]);
    expect(views.saveView).toHaveBeenCalledWith("u1", "b1", expect.anything(), 0, expect.objectContaining({ instruction: "Map first, and shelter capacity" }));
    expect((await app.request("/api/me/views/b1/edit", json({ instruction: "Hide the map" }))).status).toBe(429);
    expect((await app.request("/api/me/views/b1/edit", json({ instruction: "x" }))).status).toBe(400);
    app.dispose();
  });

  it("answers 504 when the edit model times out", async () => {
    const layoutModel = vi.fn(
      ({ signal }: { signal: AbortSignal }) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    const app = createApp({ layoutModel, viewEditTimeoutMs: 20 });
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic());
    const r = await app.request("/api/me/views/b1/edit", json({ instruction: "Map bigger" }));
    expect(r.status).toBe(504);
    expect(views.saveView).not.toHaveBeenCalled();
    app.dispose();
  });

  it("refuses edits and saves on a board that is still building", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic({ spec: null }));
    expect((await app.request("/api/me/views/b1", json({ layout: {}, rev: 0 }))).status).toBe(409);
    expect((await app.request("/api/me/views/b1/edit", json({ instruction: "Map bigger" }))).status).toBe(409);
    app.dispose();
  });

  it("undoes, 404s with nothing to undo, and deletes", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    boards.getBoard.mockResolvedValue(topic());
    views.undoView.mockResolvedValueOnce(null);
    expect((await app.request("/api/me/views/b1/undo", { method: "POST" })).status).toBe(404);
    views.undoView.mockResolvedValueOnce({ layout: { order: ["gone", "map"], hidden: [], size: {}, pinned: [], filters: {}, extras: [], header: { compact: false }, baseVersion: 1 }, rev: 6 });
    const r = await app.request("/api/me/views/b1/undo", { method: "POST" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(expect.objectContaining({ rev: 6, layout: expect.objectContaining({ order: ["map"] }) }));
    expect(await (await app.request("/api/me/views/b1", { method: "DELETE" })).json()).toEqual({ ok: true });
    expect(views.deleteView).toHaveBeenCalledWith("u1", "b1");
    app.dispose();
  });

  it("lists the user's views", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    views.listViews.mockResolvedValue([{ id: "b1", changedSinceVisit: true }] as never);
    expect(await (await app.request("/api/me/views")).json()).toEqual({ views: [{ id: "b1", changedSinceVisit: true }] });
    expect(views.listViews).toHaveBeenCalledWith("u1", 20);
    app.dispose();
  });
});

describe("admin", () => {
  it("creates a system topic and queues its build, for admins only", async () => {
    const app = createApp();
    const post = () => app.request("/api/admin/topics", json({ prompt: "Floods in Valencia, Spain" }));
    expect((await post()).status).toBe(401);
    session.sessionUserId.mockResolvedValue("u1");
    expect((await post()).status).toBe(403);
    session.sessionUserId.mockResolvedValue("admin");
    boards.createBoard.mockResolvedValue({ id: "b9", slug: "s9" });
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: "b9", slug: "s9" });
    expect(boards.createBoard).toHaveBeenCalledWith("Floods in Valencia, Spain", null, { origin: "system" });
    expect(jobs.enqueue).toHaveBeenCalledWith("build", "b9", {});
    app.dispose();
  });

  it("lists candidates and requests for admins only", async () => {
    const app = createApp();
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/admin/candidates")).status).toBe(403);
    expect((await app.request("/api/admin/requests")).status).toBe(403);
    session.sessionUserId.mockResolvedValue("admin");
    expect(await (await app.request("/api/admin/candidates?limit=5")).json()).toEqual({ candidates: [] });
    expect(views.listCandidates).toHaveBeenCalledWith(5);
    expect((await app.request("/api/admin/requests?boardId=b1&status=open")).status).toBe(200);
    expect(views.listTopicRequests).toHaveBeenCalledWith({ boardId: "b1", status: "open", limit: 100 });
    expect((await app.request("/api/admin/requests?status=bogus")).status).toBe(400);
    app.dispose();
  });

  it("lets only admins change a shared topic", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(topic());
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/boards/b1/edit", json({ instruction: "Add road closures" }))).status).toBe(403);
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(403);
    expect((await app.request("/api/boards/b1/visibility", json({ visibility: "unlisted" }))).status).toBe(403);
    expect((await app.request("/api/boards/b1", { method: "DELETE" })).status).toBe(403);
    session.sessionUserId.mockResolvedValue("admin");
    expect((await app.request("/api/boards/b1/edit", json({ instruction: "Add road closures" }))).status).toBe(200);
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(200);
    app.dispose();
  });

  it("runs monitors on refresh for an admin of a shared topic, not for others", async () => {
    const app = createApp();
    boards.getBoard.mockImplementation(async (id: string) => topic({ id }));
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/boards/t1/refresh", { method: "POST" })).status).toBe(200);
    expect(monitors.runBoardMonitors).not.toHaveBeenCalled();
    session.sessionUserId.mockResolvedValue("admin");
    expect((await app.request("/api/boards/t2/refresh", { method: "POST" })).status).toBe(200);
    expect(monitors.runBoardMonitors).toHaveBeenCalledWith("t2");
    app.dispose();
  });
});

describe("admin login, session and settings", () => {
  const PASSWORD = "test-pass-42";
  const salt = "00112233445566778899aabbccddeeff";
  const login = (app: ReturnType<typeof createApp>, username: string, password: string) =>
    app.request("/api/admin/login", json({ username, password }));
  const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
  const withCookie = (cookie: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string>), cookie } });

  beforeEach(() => {
    process.env.ADMIN_USERNAME = "tester";
    process.env.ADMIN_PASSWORD_HASH = `scrypt:${salt}:${scryptSync(PASSWORD, salt, 64).toString("hex")}`;
    process.env.ADMIN_SESSION_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  it("signs in with the right password and sets an httpOnly 12 hour cookie", async () => {
    const app = createApp();
    const r = await login(app, "tester", PASSWORD);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ admin: true });
    const set = r.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^fd_admin=/);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Max-Age=43200");
    expect(set).not.toContain("Domain=");
    const session = await app.request("/api/admin/session", withCookie(cookieOf(r)));
    expect(await session.json()).toEqual({ admin: true });
    expect(await (await app.request("/api/admin/session")).json()).toEqual({ admin: false });
    app.dispose();
  });

  it("scopes the cookie to the domain and marks it Secure in production", async () => {
    const app = createApp({ domain: "faraday.watch" });
    const r = await login(app, "tester", PASSWORD);
    expect(r.headers.get("set-cookie")).toContain("Domain=.faraday.watch");
    expect(r.headers.get("set-cookie")).toContain("Secure");
    app.dispose();
  });

  it("answers 401 for a wrong username or password, and 401 when the env is incomplete", async () => {
    const app = createApp();
    expect((await login(app, "tester", "nope")).status).toBe(401);
    expect(await (await login(app, "someone", PASSWORD)).json()).toEqual({ error: "Wrong username or password" });
    delete process.env.ADMIN_SESSION_SECRET;
    expect((await login(app, "tester", PASSWORD)).status).toBe(401);
    app.dispose();
  });

  it("rate limits failed logins per address", async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) expect((await login(app, "tester", "wrong")).status).toBe(401);
    const blocked = await login(app, "tester", "wrong");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    conn.address = "198.51.100.7";
    expect((await login(app, "tester", PASSWORD)).status).toBe(200);
    app.dispose();
  });

  it("refuses even the right password from a blocked address", async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) expect((await login(app, "tester", "wrong")).status).toBe(401);
    const r = await login(app, "tester", PASSWORD);
    expect(r.status).toBe(429);
    expect(r.headers.get("set-cookie")).toBeNull();
    app.dispose();
  });

  it("rejects a tampered or expired cookie", async () => {
    const app = createApp();
    const good = cookieOf(await login(app, "tester", PASSWORD));
    const [name, value] = good.split("=");
    const [exp, mac] = decodeURIComponent(value).split(".");
    const tampered = `${name}=${encodeURIComponent(`${Number(exp) + 1000}.${mac}`)}`;
    expect(await (await app.request("/api/admin/session", withCookie(tampered))).json()).toEqual({ admin: false });
    const expired = `${name}=${encodeURIComponent(issueAdminToken(Date.now() - 13 * 3_600_000)!)}`;
    expect(await (await app.request("/api/admin/session", withCookie(expired))).json()).toEqual({ admin: false });
    app.dispose();
  });

  it("logs out by clearing the cookie", async () => {
    const app = createApp();
    const r = await app.request("/api/admin/logout", { method: "POST" });
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("set-cookie")).toMatch(/^fd_admin=; .*Max-Age=0/);
    app.dispose();
  });

  it("reads and toggles discovery for admins only", async () => {
    const app = createApp();
    expect((await app.request("/api/admin/settings")).status).toBe(401);
    expect((await app.request("/api/admin/settings", json({ discoverEnabled: true }))).status).toBe(401);
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/admin/settings")).status).toBe(403);
    session.sessionUserId.mockResolvedValue(null);
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
    expect(await (await app.request("/api/admin/settings", withCookie(cookie))).json()).toEqual({ discoverEnabled: false });
    settings.discoverEnabled.mockResolvedValueOnce(true);
    const on = await app.request("/api/admin/settings", withCookie(cookie, json({ discoverEnabled: true })));
    expect(await on.json()).toEqual({ discoverEnabled: true });
    expect(settings.setDiscoverEnabled).toHaveBeenCalledWith(true);
    expect((await app.request("/api/admin/settings", withCookie(cookie, json({ discoverEnabled: "yes" })))).status).toBe(400);
    app.dispose();
  });

  it("lists system topics and sets their state for an admin cookie", async () => {
    const app = createApp();
    expect((await app.request("/api/admin/topics")).status).toBe(401);
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
    expect(await (await app.request("/api/admin/topics", withCookie(cookie))).json()).toEqual({ topics: [] });
    boards.getBoard.mockResolvedValue(topic({ tier: "warm" }));
    const restore = await app.request("/api/admin/topics/b1/state", withCookie(cookie, json({ state: "active" })));
    expect(await restore.json()).toEqual({ ok: true });
    expect(topicsRepo.setTopicState).toHaveBeenCalledWith("b1", "active", expect.any(Number));
    expect(jobs.enqueue).toHaveBeenCalledWith("poll", "b1", { reason: "manual" });
    expect((await app.request("/api/admin/topics/b1/state", withCookie(cookie, json({ state: "archived" })))).status).toBe(200);
    expect(monitors.removeBoardMonitors).toHaveBeenCalledWith("b1");
    topicsRepo.setTopicState.mockResolvedValueOnce(false);
    expect((await app.request("/api/admin/topics/nope/state", withCookie(cookie, json({ state: "active" })))).status).toBe(404);
    expect((await app.request("/api/admin/topics/b1/state", withCookie(cookie, json({ state: "merged" })))).status).toBe(400);
    app.dispose();
  });

  it("lets an admin cookie change a shared topic while other users get 403", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(topic());
    session.sessionUserId.mockResolvedValue("u1");
    expect((await app.request("/api/boards/b1/edit", json({ instruction: "Add road closures" }))).status).toBe(403);
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
    session.sessionUserId.mockResolvedValue(null);
    expect((await app.request("/api/boards/b1/edit", withCookie(cookie, json({ instruction: "Add road closures" })))).status).toBe(200);
    boards.createBoard.mockResolvedValue({ id: "b9", slug: "s9" });
    expect((await app.request("/api/admin/topics", withCookie(cookie, json({ prompt: "Floods in Valencia, Spain" })))).status).toBe(200);
    app.dispose();
  });

  it("resuming a shared topic makes it an active topic again", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(topic({ tier: "paused", topicState: "archived" }));
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
    expect((await app.request("/api/boards/b1/resume", withCookie(cookie, { method: "POST" }))).status).toBe(200);
    expect(topicsRepo.setTopicState).toHaveBeenCalledWith("b1", "active", expect.any(Number));
    expect(boards.setSchedule).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith("poll", "b1", { reason: "manual" });
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

  it("refuses paused boards and shared topics that are not active", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValueOnce(row({ tier: "paused" }));
    expect((await app.request("/api/boards/b1/refresh", { method: "POST" })).status).toBe(409);
    boards.getBoard.mockResolvedValueOnce(topic({ topicState: "archived", tier: "warm" }));
    const r = await app.request("/api/boards/b2/refresh", { method: "POST" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "Live updates are paused for this board" });
    expect(jobs.enqueue).not.toHaveBeenCalled();
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
    expect(boards.addEvent).toHaveBeenCalledWith("b1", "info", "This board was deleted.", null);
    expect(boards.deleteBoard).toHaveBeenCalledWith("b1");
    expect(boards.addEvent.mock.invocationCallOrder[0]).toBeLessThan(boards.deleteBoard.mock.invocationCallOrder[0]);
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

  it("cleans up a viewer that leaves while the replay is still loading", async () => {
    const app = createApp({ pingMs: 60_000 });
    boards.getBoard.mockResolvedValue(row());
    let release!: (v: BoardEvent[]) => void;
    boards.listEvents.mockReturnValue(new Promise<BoardEvent[]>((r) => (release = r)));
    const before = sseState.connections;
    const res = await app.request("/api/boards/b1/stream", { headers: { "Last-Event-ID": "10" } });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    release([ev(11)]);
    await new Promise((r) => setTimeout(r, 50));
    expect(sseState.connections).toBe(before);
    app.dispose();
  });

  it("404s for an unknown board", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(null);
    expect((await app.request("/api/boards/zz/stream")).status).toBe(404);
    app.dispose();
  });
});
