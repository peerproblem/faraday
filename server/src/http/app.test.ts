import { generateKeyPairSync, scryptSync, sign as edSign } from "node:crypto";
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
const evidence = vi.hoisted(() => ({ contextEvidencePage: vi.fn() }));
const runs = vi.hoisted(() => ({ latestRunView: vi.fn(), latestWorkerHeartbeat: vi.fn(), nodeStats: vi.fn() }));
const monitors = vi.hoisted(() => ({ removeBoardMonitors: vi.fn(), runBoardMonitors: vi.fn() }));
const candidates = vi.hoisted(() => ({ listCandidates: vi.fn(async () => []) }));
const conn = vi.hoisted(() => ({ address: "203.0.113.9" }));
const settings = vi.hoisted(() => ({
  discoverEnabled: vi.fn(async () => false),
  setDiscoverEnabled: vi.fn(async () => {}),
  distributeLive: vi.fn(async () => false),
  setDistributeLive: vi.fn(async () => {}),
}));
const topicsRepo = vi.hoisted(() => ({ listAdminTopics: vi.fn(async () => []), setTopicState: vi.fn(async () => true) }));
const layouts = vi.hoisted(() => ({
  getBoardLayout: vi.fn(),
  getBoardLayoutTemplate: vi.fn(),
  listBoardLayoutTemplates: vi.fn(async () => []),
  createBoardLayoutTemplate: vi.fn(),
  updateBoardLayoutTemplate: vi.fn(),
  setBoardLayout: vi.fn(),
}));

vi.mock("../repo/boards", () => boards);
vi.mock("../repo/board-layouts", () => layouts);
vi.mock("../repo/jobs", () => jobs);
vi.mock("../repo/context-evidence", () => evidence);
vi.mock("../repo/runs", () => runs);
vi.mock("../monitors", () => monitors);
vi.mock("../repo/candidates", () => candidates);
vi.mock("../repo/settings", () => settings);
vi.mock("../repo/topics", () => topicsRepo);
vi.mock("../db/pool", () => ({ one: vi.fn(async () => ({ ok: 1 })), all: vi.fn(async () => []) }));
vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo: () => ({ remote: { address: conn.address } }) }));

const { createApp: createRealApp, sseState } = await import("./app");
const { publish } = await import("../bus");
const { sign } = await import("./signature");
const { issueAdminToken } = await import("./admin-auth");

/** Whether the requests of the next calls carry a valid /admin session cookie. */
const who = { admin: false };
const TEST_ADMIN_SALT = "ffeeddccbbaa99887766554433221100";
function adminEnv() {
  process.env.ADMIN_USERNAME = "tester";
  process.env.ADMIN_PASSWORD_HASH = `scrypt:${TEST_ADMIN_SALT}:${scryptSync("admin-pass", TEST_ADMIN_SALT, 64).toString("hex")}`;
  process.env.ADMIN_SESSION_SECRET = "test-secret";
}
/** The real app, with an admin cookie added to each request while who.admin is set. */
function createApp(opts?: Parameters<typeof createRealApp>[0]) {
  const app = createRealApp(opts);
  const request = app.request.bind(app);
  app.request = ((input: string, init: RequestInit = {}) => {
    if (!who.admin) return request(input, init);
    const headers = new Headers(init.headers);
    const token = issueAdminToken();
    if (token) headers.set("cookie", [headers.get("cookie"), `fd_admin=${encodeURIComponent(token)}`].filter(Boolean).join("; "));
    return request(input, { ...init, headers });
  }) as typeof app.request;
  return app;
}

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
  layouts.getBoardLayout.mockResolvedValue({ rev: 0, assignment: null });
  layouts.setBoardLayout.mockImplementation(async (_id, assignment, rev) => ({ ok: true, value: { assignment, rev: rev + 1 } }));
  adminEnv();
  conn.address = "203.0.113.9";
  who.admin = false;
  jobs.queueStats.mockResolvedValue({ queued: { build: 0, edit: 0, poll: 0, cleanup: 0 }, running: 0, failedLastHour: 0 });
  jobs.hasPendingJob.mockResolvedValue(false);
  jobs.enqueue.mockResolvedValue(1);
  boards.addEvent.mockImplementation(async (_b: string, kind: string, message: string) => ({ id: 99, ts: 1, kind, message, data: null }));
  monitors.removeBoardMonitors.mockResolvedValue(1);
  monitors.runBoardMonitors.mockResolvedValue(undefined);
});

describe("board views", () => {
  it("pages evidence for the requested board and validates the search group and cursor", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValueOnce(undefined);
    expect((await app.request("/api/boards/missing/evidence")).status).toBe(404);
    expect((await app.request("/api/boards/b1/evidence?group=other")).status).toBe(400);
    expect((await app.request("/api/boards/b1/evidence?before=0")).status).toBe(400);
    boards.getBoard.mockResolvedValueOnce(row());
    evidence.contextEvidencePage.mockResolvedValueOnce({ items: [], nextBefore: null });
    const page = await app.request("/api/boards/b1/evidence?group=monitor&before=40");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.json()).toEqual({ items: [], nextBefore: null });
    expect(evidence.contextEvidencePage).toHaveBeenCalledWith("b1", "monitor", 40);
    app.dispose();
  });

  it("keeps the finance market desk and strips its template from the public response", async () => {
    const app = createApp();
    boards.getBoardView.mockResolvedValue(view({ spec: { version: 2, widgets: [], template: "finance" } }));
    const body = await (await app.request("/api/boards/b1")).json() as BoardView;
    expect(body.presentation).toEqual({ workspace: false, marketPrices: true });
    expect(body.spec).toEqual({ version: 2, widgets: [] });
    app.dispose();
  });

  it("serves only renderer flags for a saved layout and changes the view ETag on assignment", async () => {
    const app = createApp();
    const settings = { layout: "map", timelineOpen: false, evidenceOpen: true };
    boards.getBoardView.mockResolvedValue(view());
    const first = await app.request("/api/boards/b1");
    layouts.getBoardLayout.mockResolvedValue({ rev: 1, assignment: { templateId: "internal-id", settings } });
    publish("b1", { type: "status", status: "live", tier: "hot" });
    const next = await app.request("/api/boards/b1", { headers: { "If-None-Match": first.headers.get("etag")! } });
    expect(next.status).toBe(200);
    const body = await next.text();
    expect(body).not.toContain("internal-id");
    expect(JSON.parse(body).presentation).toEqual({ workspace: true, cardsOnMap: true, timelineOpen: false, evidenceOpen: true });
    const cards = [{ id: "access", title: "Access", placement: "right", open: true, contents: [{ kind: "summary" }] }];
    const sidebar = { title: "Sources", open: false, contents: [{ kind: "widget", type: "sources" }] };
    layouts.getBoardLayout.mockResolvedValue({ rev: 2, assignment: { templateId: "internal-id", settings: { ...settings, cards, sidebar } } });
    publish("b1", { type: "status", status: "live", tier: "hot" });
    const composed = await app.request("/api/boards/b1", { headers: { "If-None-Match": next.headers.get("etag")! } });
    expect(composed.status).toBe(200);
    expect((await composed.json() as BoardView).presentation).toMatchObject({ cards, sidebar });
    app.dispose();
  });

  it("requires an admin to assign a template and saves settings only for the selected board", async () => {
    const app = createApp();
    const settings = { layout: "grid", timelineOpen: true, evidenceOpen: false };
    const path = "/api/admin/boards/b1/layout";
    const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: "t1", rev: 0 }) };
    expect((await app.request(path, request)).status).toBe(401);
    expect(layouts.setBoardLayout).not.toHaveBeenCalled();
    who.admin = true;
    boards.getBoard.mockResolvedValue(row());
    layouts.getBoardLayoutTemplate.mockResolvedValue({ id: "t1", name: "Grid", settings });
    expect((await app.request(path, request)).status).toBe(200);
    expect(layouts.setBoardLayout).toHaveBeenCalledExactlyOnceWith("b1", { templateId: "t1", settings }, 0);
    const current = { assignment: { templateId: "t1", settings }, rev: 1 };
    layouts.setBoardLayout.mockResolvedValueOnce({ ok: false, current });
    const conflict = await app.request(path, { ...request, method: "DELETE", body: JSON.stringify({ rev: 0 }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ current });
    app.dispose();
  });

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
    who.admin = true;
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
    who.admin = true;
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
    expect((await app.request("/api/topics?type=natural-disasters")).status).toBe(200);
    expect(boards.listTopics).toHaveBeenLastCalledWith({ state: "active", crisisType: "natural-disasters", limit: 50 });
    expect((await app.request("/api/topics?type=economy")).status).toBe(200);
    expect((await app.request("/api/topics?type=unknown-category")).status).toBe(400);
    app.dispose();
  });
});

describe("admin", () => {
  it("creates a system topic and queues its build, for admins only", async () => {
    const app = createApp();
    const post = () => app.request("/api/admin/topics", json({ prompt: "Floods in Valencia, Spain" }));
    expect((await post()).status).toBe(401);
    who.admin = true;
    boards.createBoard.mockResolvedValue({ id: "b9", slug: "s9" });
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: "b9", slug: "s9" });
    expect(boards.createBoard).toHaveBeenCalledWith("Floods in Valencia, Spain", null, { origin: "system" });
    expect(jobs.enqueue).toHaveBeenCalledWith("build", "b9", {});
    app.dispose();
  });

  it("lists candidates for admins only, and has no topic requests any more", async () => {
    const app = createApp();
    expect((await app.request("/api/admin/candidates")).status).toBe(401);
    who.admin = true;
    expect(await (await app.request("/api/admin/candidates?limit=5")).json()).toEqual({ candidates: [] });
    expect(candidates.listCandidates).toHaveBeenCalledWith(5);
    expect((await app.request("/api/admin/requests")).status).toBe(404);
    app.dispose();
  });

  it("lets only admins change a shared topic", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(topic());
    expect((await app.request("/api/boards/b1/edit", json({ instruction: "Add road closures" }))).status).toBe(403);
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(403);
    expect((await app.request("/api/boards/b1/visibility", json({ visibility: "unlisted" }))).status).toBe(403);
    expect((await app.request("/api/boards/b1", { method: "DELETE" })).status).toBe(403);
    who.admin = true;
    expect((await app.request("/api/boards/b1/edit", json({ instruction: "Add road closures" }))).status).toBe(200);
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(200);
    app.dispose();
  });

  it("runs monitors on refresh for an admin of a shared topic, not for others", async () => {
    const app = createApp();
    boards.getBoard.mockImplementation(async (id: string) => topic({ id }));
    expect((await app.request("/api/boards/t1/refresh", { method: "POST" })).status).toBe(200);
    expect(monitors.runBoardMonitors).not.toHaveBeenCalled();
    who.admin = true;
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
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
    const off = { discoverEnabled: false, distributeLive: false, distributeReady: false };
    expect(await (await app.request("/api/admin/settings", withCookie(cookie))).json()).toEqual(off);
    settings.discoverEnabled.mockResolvedValueOnce(true);
    const on = await app.request("/api/admin/settings", withCookie(cookie, json({ discoverEnabled: true })));
    expect(await on.json()).toEqual({ ...off, discoverEnabled: true });
    expect(settings.setDiscoverEnabled).toHaveBeenCalledWith(true);
    expect(settings.setDistributeLive).not.toHaveBeenCalled();
    expect((await app.request("/api/admin/settings", withCookie(cookie, json({ discoverEnabled: "yes" })))).status).toBe(400);
    expect((await app.request("/api/admin/settings", withCookie(cookie, json({})))).status).toBe(400);
    app.dispose();
  });

  it("turns real posting to X and Discord on and off for admins only", async () => {
    const app = createApp();
    expect((await app.request("/api/admin/settings", json({ distributeLive: true }))).status).toBe(401);
    expect(settings.setDistributeLive).not.toHaveBeenCalled();
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
    settings.distributeLive.mockResolvedValueOnce(true);
    const on = await app.request("/api/admin/settings", withCookie(cookie, json({ distributeLive: true })));
    expect(await on.json()).toMatchObject({ distributeLive: true });
    expect(settings.setDistributeLive).toHaveBeenCalledWith(true);
    expect((await app.request("/api/admin/settings", withCookie(cookie, json({ distributeLive: "on" })))).status).toBe(400);
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

  it("lets an admin cookie change a shared topic while everyone else gets 403", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(topic());
    expect((await app.request("/api/boards/b1/edit", json({ instruction: "Add road closures" }))).status).toBe(403);
    const cookie = cookieOf(await login(app, "tester", PASSWORD));
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
  it("allows one check per board per minute and only runs monitors for an admin", async () => {
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
    who.admin = true;
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

describe("legacy prompt board actions", () => {
  it("refuses everyone but an admin, including the board's old owner", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    expect((await app.request("/api/boards/b1/pause", { method: "POST" })).status).toBe(403);
    expect((await app.request("/api/boards/b1", { method: "DELETE" })).status).toBe(403);
    expect(boards.deleteBoard).not.toHaveBeenCalled();
    app.dispose();
  });

  it("pauses (removing monitors) and resumes (queueing a poll)", async () => {
    const app = createApp();
    boards.getBoard.mockResolvedValue(row());
    who.admin = true;
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
    who.admin = true;
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
    who.admin = true;
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
    boards.getBoard.mockResolvedValue({ ...row(), lastPolledAt: 1000 });
    boards.listEvents.mockResolvedValue([ev(12), ev(11)]);
    const res = await app.request("/api/boards/b1/stream", { headers: { "Last-Event-ID": "10" } });
    expect(res.status).toBe(200);
    setTimeout(() => {
      publish("b1", { type: "event", event: ev(12) });
      publish("b1", { type: "polled", lastPolledAt: 2000 });
      publish("b1", { type: "spec", version: 3, spec: { version: 2, widgets: [], template: "finance" } });
      publish("b1", { type: "event", event: ev(13) });
    }, 50);
    const text = await readUntil(res, (t) => t.includes('"e13"'));
    expect(boards.listEvents).toHaveBeenCalledWith("b1", { afterId: 10, limit: 200 });
    const frames = text.split("\n\n").filter((f) => f.includes("data:"));
    const parsed = frames.map((f) => ({
      id: /^id: ?(.*)$/m.exec(f)?.[1] ?? null,
      event: /^event: ?(.*)$/m.exec(f)?.[1] ?? null,
      msg: JSON.parse(/^data: ?(.*)$/m.exec(f)![1]) as { type: string; version?: number; event?: BoardEvent },
    }));
    expect(parsed[0].msg).toEqual({ type: "hello", version: 3, lastPolledAt: 1000 });
    expect(parsed.find((frame) => frame.event === "polled")?.msg).toEqual({ type: "polled", lastPolledAt: 2000 });
    expect(parsed.find((frame) => frame.msg.type === "spec")?.msg)
      .toEqual({ type: "spec", version: 3, spec: { version: 2, widgets: [] } });
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

describe("Discord interactions", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
  const post = (app: ReturnType<typeof createApp>, raw: string, signed = true) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = signed ? { "x-signature-ed25519": edSign(null, Buffer.from(ts + raw), privateKey).toString("hex"), "x-signature-timestamp": ts } : {};
    return app.request("/api/webhooks/discord", { method: "POST", body: raw, headers });
  };
  afterEach(() => vi.unstubAllEnvs());

  it("answers a signed ping, refuses unsigned requests, and is off without configuration", async () => {
    const app = createApp();
    expect((await post(app, '{"type":1}')).status).toBe(404);
    expect((await app.request("/api/discord/install")).status).toBe(404);
    vi.stubEnv("DISCORD_BOT_TOKEN", "t");
    vi.stubEnv("DISCORD_APPLICATION_ID", "123");
    vi.stubEnv("DISCORD_PUBLIC_KEY", pubHex);
    expect((await post(app, '{"type":1}', false)).status).toBe(401);
    const ping = await post(app, '{"type":1}');
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ type: 1 });
    const install = await app.request("/api/discord/install");
    expect(install.status).toBe(302);
    expect(install.headers.get("location")).toBe("https://discord.com/oauth2/authorize?client_id=123&scope=bot+applications.commands&permissions=19456");
    app.dispose();
  });
});
