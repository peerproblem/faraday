import { describe, expect, it } from "vitest";
import { useTestDb } from "../test/db";
import { all, run } from "../db/pool";
import type { BoardData, BoardSpecV2, Plan } from "../spec";
import {
  addEvent,
  addMessage,
  addSources,
  boardIdForSlug,
  countActiveBoards,
  countRecentBoards,
  createBoard,
  deleteBoard,
  deleteMonitorRow,
  discardSources,
  getBoard,
  getBoardView,
  getSourceTexts,
  listBoards,
  listDueBoards,
  listEvents,
  listLiveBoardsForTiering,
  listMessages,
  listMonitors,
  listSources,
  listV1BoardIds,
  markExtracted,
  markPolled,
  monitorById,
  pruneOldData,
  saveBoardVersion,
  saveMonitor,
  savePlan,
  saveSourceText,
  setMonitorSeen,
  setSchedule,
  setSourceTriage,
  setStatus,
  setVisibility,
  slugExists,
  touchViewed,
} from "./boards";

const { enabled } = useTestDb("repo_boards");

const plan = {
  title: "Valencia Floods",
  subtitle: null,
  crisisType: "flood",
  language: "es",
  location: { name: "Valencia, Spain", zoom: 9 },
  lookbackDays: 3,
  entities: ["Valencia"],
  newsQueries: ["valencia floods"],
  webQueries: ["valencia flood shelters"],
  monitor: { query: "valencia floods", instructions: "new deaths" },
  metrics: [{ key: "deaths", label: "Muertos", unit: null, why: "x" }],
  tables: [],
  statusGroups: [],
  questions: [{ id: "q1", text: "How many died?" }],
  widgets: [],
} satisfies Plan;

const spec: BoardSpecV2 = { version: 2, widgets: [{ id: "w1", type: "narrative", title: "Situation", span: "full", bind: null, metrics: [] }] };
const data = (headline: string): BoardData => ({
  header: {
    title: "Valencia Floods",
    subtitle: null,
    crisisType: "flood",
    accent: "blue",
    headline: { text: headline, sources: ["s1"] },
    status: "ongoing",
    statusP: null,
    severity: 3.6,
    severityP: null,
    location: null,
    asOf: null,
    language: "es",
  },
  widgets: { w1: { sentences: [{ text: headline, sources: ["s1"] }] } },
  hidden: [],
  generatedAt: 1,
});

describe.skipIf(!enabled)("repo/boards", () => {
  it("creates a v2 board with its first message", async () => {
    const { id, slug } = await createBoard("Floods in Valencia: deaths and shelters", "u1");
    expect(slug).toMatch(/^floods-in-valencia-deaths-and-[a-z0-9]{5}$/);
    const b = await getBoard(id);
    expect(b).toMatchObject({ status: "queued", tier: "hot", visibility: "public", specVersion: 2, version: 0, spec: null, data: null });
    expect(await listMessages(id)).toEqual([expect.objectContaining({ role: "user", content: "Floods in Valencia: deaths and shelters" })]);
    expect(await boardIdForSlug(slug)).toBe(id);
    expect(await slugExists(slug)).toBe(true);
  });

  it("saves plans and versions, keeps 50 versions, fills list columns", async () => {
    const { id } = await createBoard("Valencia floods board", "u2");
    await savePlan(id, plan);
    let v = 0;
    for (let i = 0; i < 53; i++) v = await saveBoardVersion(id, { spec, data: data(`h${i}`), changeNote: `n${i}`, status: i === 0 ? "live" : undefined });
    expect(v).toBe(53);
    const versions = await all<{ version: number }>(`SELECT version FROM board_versions WHERE board_id = ? ORDER BY version`, [id]);
    expect(versions).toHaveLength(50);
    expect(Number(versions[0].version)).toBe(4);
    const view = (await getBoardView(id))!;
    expect(view).toMatchObject({ status: "live", specVersion: 2, version: 53, language: "es", spec, plan });
    expect(view.data?.header.headline?.text).toBe("h52");
    const [card] = (await listBoards({ limit: 10, ownerId: "u2" }))!;
    expect(card).toMatchObject({ id, crisisType: "flood", severity: 3.6, headline: "h52", accent: "blue", title: "Valencia Floods", tier: "hot" });
  });

  it("dedupes sources by url without fragment and continues ids", async () => {
    const { id } = await createBoard("Sources board here", null);
    const doc = (url: string) => ({ url, title: url, publisher: "p", publishedAt: null, snippet: "s", kind: "news" as const });
    const a = await addSources(id, [doc("https://a.example/1#top"), doc("https://a.example/1"), doc("https://a.example/2")]);
    expect(a.map((s) => [s.id, s.url])).toEqual([
      ["s1", "https://a.example/1"],
      ["s2", "https://a.example/2"],
    ]);
    const b = await addSources(id, [doc("https://a.example/2#x"), doc("https://a.example/3")]);
    expect(b.map((s) => s.id)).toEqual(["s3"]);
    await setSourceTriage(id, [{ id: "s1", relevance: 0.91, sourceType: "official" }]);
    await discardSources(id, ["s2"]);
    await markExtracted(id, ["s1"]);
    const list = await listSources(id);
    expect(list.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(list[0]).toMatchObject({ relevance: expect.closeTo(0.91, 2), sourceType: "official" });
    expect((await listSources(id, { includeDiscarded: true })).length).toBe(3);
    await saveSourceText(id, "s1", "# one");
    await saveSourceText(id, "s1", "# one v2");
    expect(await getSourceTexts(id, ["s1", "s3"])).toEqual(new Map([["s1", "# one v2"]]));
  });

  it("lists events newest first, or after an id oldest first", async () => {
    const { id } = await createBoard("Events board here", null);
    const e1 = await addEvent(id, "stage", "one");
    const e2 = await addEvent(id, "update", "two", { a: 1 });
    await addEvent(id, "info", "three");
    expect((await listEvents(id)).map((e) => e.message)).toEqual(["three", "two", "one"]);
    expect((await listEvents(id, { afterId: e1.id })).map((e) => e.message)).toEqual(["two", "three"]);
    expect((await listEvents(id, { limit: 1 }))[0].message).toBe("three");
    expect((await listEvents(id, { afterId: e1.id }))[0]).toEqual({ ...e2, data: { a: 1 } });
    await addMessage(id, "assistant", "done");
    expect((await listMessages(id)).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("schedules, tiers and reports due boards", async () => {
    const { id } = await createBoard("Schedule board here", "u3");
    await saveBoardVersion(id, { spec, data: data("x"), changeNote: null, status: "live" });
    const now = Date.now();
    await setSchedule(id, { tier: "warm", nextPollAt: now - 1000 });
    expect((await listDueBoards(now, 100)).map((b) => b.id)).toContain(id);
    await setSchedule(id, { nextPollAt: now + 60_000 });
    expect((await listDueBoards(now, 100)).map((b) => b.id)).not.toContain(id);
    await markPolled(id, now);
    await touchViewed(id, now);
    const t = (await listLiveBoardsForTiering()).find((b) => b.id === id)!;
    expect(t).toMatchObject({ tier: "warm", lastViewedAt: now, situation: "ongoing" });
    expect(await countActiveBoards("u3")).toBe(1);
    await setSchedule(id, { tier: "paused" });
    expect(await countActiveBoards("u3")).toBe(0);
    expect((await listDueBoards(now + 120_000, 100)).map((b) => b.id)).not.toContain(id);
    await setStatus(id, "error");
    expect((await listLiveBoardsForTiering()).some((b) => b.id === id)).toBe(false);
  });

  it("filters by visibility and hides deleted boards everywhere", async () => {
    const { id, slug } = await createBoard("Private board here", "u4");
    await setVisibility(id, "unlisted");
    expect((await listBoards({ limit: 100, publicOnly: true })).some((b) => b.id === id)).toBe(false);
    expect((await listBoards({ limit: 100, ownerId: "u4" })).some((b) => b.id === id)).toBe(true);
    expect(await countRecentBoards("u4", Date.now() - 60_000)).toBe(1);
    await deleteBoard(id);
    expect(await getBoard(id)).toBeNull();
    expect(await getBoardView(id)).toBeNull();
    expect(await boardIdForSlug(slug)).toBeNull();
    expect(await slugExists(slug)).toBe(false);
    expect((await listBoards({ limit: 100, ownerId: "u4" })).length).toBe(0);
    expect(await countRecentBoards("u4", Date.now() - 60_000)).toBe(1);
  });

  it("stores monitors with targets and secrets", async () => {
    const { id } = await createBoard("Monitor board here", null);
    await saveMonitor({ id: "mon_1", boardId: id, kind: "search", target: "valencia floods", webhookSecret: "sec" });
    await saveMonitor({ id: "mon_2", boardId: id, kind: "page", target: "https://gva.es/alerts", webhookSecret: null });
    expect((await listMonitors(id)).map((m) => [m.id, m.kind, m.target])).toEqual([
      ["mon_1", "search", "valencia floods"],
      ["mon_2", "page", "https://gva.es/alerts"],
    ]);
    await setMonitorSeen("mon_1", "2026-11-14T10:00:00Z");
    expect(await monitorById("mon_1")).toMatchObject({ lastSeenChangeAt: "2026-11-14T10:00:00Z", webhookSecret: "sec", boardId: id });
    await deleteMonitorRow("mon_2");
    expect((await listMonitors(id)).length).toBe(1);
  });

  it("reports v1 boards and returns null spec for them", async () => {
    const { id } = await createBoard("Old v1 board", null);
    await run(`UPDATE boards SET spec_version = 1, spec = '{"title":"old"}', plan = '{"title":"old"}' WHERE id = ?`, [id]);
    expect(await listV1BoardIds()).toContain(id);
    const v = (await getBoardView(id))!;
    expect(v).toMatchObject({ specVersion: 1, spec: null, data: null, plan: null });
  });

  it("prunes events beyond 500 per board", async () => {
    const { id } = await createBoard("Prune board here", null);
    const now = Date.now();
    const rows = Array.from({ length: 520 }, (_, i) => `('${id}', ${now + i}, 'info', 'e${i}', NULL)`).join(", ");
    await run(`INSERT INTO events (board_id, ts, kind, message, data) VALUES ${rows}`);
    const r = await pruneOldData(now);
    expect(r.events).toBeGreaterThanOrEqual(20);
    const left = await listEvents(id, { limit: 1000 });
    expect(left).toHaveLength(500);
    expect(left[0].message).toBe("e519");
  });
});
