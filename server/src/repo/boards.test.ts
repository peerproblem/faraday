import { describe, expect, it } from "vitest";
import { useTestDb } from "../test/db";
import { all, run } from "../db/pool";
import type { BoardData, BoardSpecV2, Plan } from "../spec";
import {
  ackMonitorChanges,
  addEvent,
  addMessage,
  addSources,
  boardIdForSlug,
  createBoard,
  deleteBoard,
  deleteMonitorRow,
  discardSources,
  forgetWebhookEvent,
  getBoard,
  getBoardView,
  getSources,
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
  markMonitorsSynced,
  markPolled,
  monitorById,
  pruneOldData,
  recordWebhookEvent,
  refreshSources,
  saveBoardVersion,
  saveMonitor,
  savePlan,
  saveSourceText,
  seenChangeIds,
  setMonitorSeen,
  setSchedule,
  setSourceLanguage,
  setSourceTriage,
  setStatus,
  setVisibility,
  slugExists,
  touchViewed,
  updateMonitorRow,
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

  it("stores which API found a source and its language and English title", async () => {
    const { id } = await createBoard("Provenance board here", null);
    const [a, b] = await addSources(id, [
      { url: "https://kyiv.example/1", title: "Графіки", publisher: "kyiv.example", publishedAt: null, snippet: "Текст", kind: "web", via: "oxylabs", geo: "UA" },
      { url: "https://news.example/2", title: "Outages", publisher: "news.example", publishedAt: null, snippet: "s", kind: "news" },
    ]);
    expect(a).toMatchObject({ via: "oxylabs", lang: null, titleEn: null });
    expect(b.via).toBeNull();
    await setSourceLanguage(id, [
      { id: "s1", lang: "uk", titleEn: "Outage schedules" },
      { id: "s2", lang: "en", titleEn: null },
    ]);
    const [s1] = await getSources(id, ["s1"]);
    expect(s1).toMatchObject({ via: "oxylabs", lang: "uk", titleEn: "Outage schedules", title: "Графіки", snippet: "Текст" });
    expect((await listSources(id))[1]).toMatchObject({ lang: "en", titleEn: null });
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
    await setSchedule(id, { tier: "paused" });
    expect((await listDueBoards(now + 120_000, 100)).map((b) => b.id)).not.toContain(id);
    await setStatus(id, "error");
    expect((await listLiveBoardsForTiering()).some((b) => b.id === id)).toBe(false);
  });

  it("filters by visibility and hides deleted boards everywhere", async () => {
    const { id, slug } = await createBoard("Private board here", "u4");
    await setVisibility(id, "unlisted");
    expect((await listBoards({ limit: 100, publicOnly: true })).some((b) => b.id === id)).toBe(false);
    expect((await listBoards({ limit: 100, ownerId: "u4" })).some((b) => b.id === id)).toBe(true);
    await deleteBoard(id);
    expect(await getBoard(id)).toBeNull();
    expect(await getBoardView(id)).toBeNull();
    expect(await boardIdForSlug(slug)).toBeNull();
    expect(await slugExists(slug)).toBe(false);
    expect((await listBoards({ limit: 100, ownerId: "u4" })).length).toBe(0);
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

  it("refreshes a known source when a monitor reports new text for its url", async () => {
    const { id } = await createBoard("Refresh board here", null);
    const [s1] = await addSources(id, [{ url: "https://status.example/incident", title: "Incident", publisher: "status.example", publishedAt: null, snippet: "300 of 500 sites are operational.", kind: "web" }]);
    await setSourceTriage(id, [{ id: s1.id, relevance: 0.9, sourceType: "official" }]);
    await saveSourceText(id, s1.id, "# Incident\n300 of 500 sites are operational.");
    await markExtracted(id, [s1.id]);
    const doc = { url: "https://status.example/incident#now", title: null, publisher: "status.example", publishedAt: "2026-11-14T10:00:00Z", snippet: "480 of 500 sites are operational.", kind: "monitor" as const, refresh: true };

    // addSources still skips the url; refreshSources re-opens the existing source.
    expect(await addSources(id, [doc])).toEqual([]);
    const [r] = await refreshSources(id, [doc]);
    expect(r).toMatchObject({ id: s1.id, title: "Incident", kind: "web", snippet: "480 of 500 sites are operational.", relevance: expect.closeTo(0.9, 2), sourceType: "official", publishedAt: "2026-11-14T10:00:00Z" });
    // The stored page text predates the change and is dropped; the source is due for extraction again.
    expect((await getSourceTexts(id, [s1.id])).size).toBe(0);
    const [row] = await all<{ extracted_at: number | null; content_hash: string | null; refreshed_at: number | null }>(
      `SELECT extracted_at, content_hash, refreshed_at FROM sources WHERE board_id = ? AND id = ?`,
      [id, s1.id],
    );
    expect(row.extracted_at).toBeNull();
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.refreshed_at).not.toBeNull();
    // Same text again before extraction: still due. After extraction: skipped.
    expect((await refreshSources(id, [doc])).map((x) => x.id)).toEqual([s1.id]);
    await markExtracted(id, [s1.id]);
    expect(await refreshSources(id, [doc])).toEqual([]);
    // Docs without refresh, and unknown urls, are ignored.
    expect(await refreshSources(id, [{ ...doc, refresh: undefined, snippet: "x" }, { ...doc, url: "https://other.example/" }])).toEqual([]);
  });

  it("puts a discarded source back up for triage when its page changes", async () => {
    const { id } = await createBoard("Refresh discarded board", null);
    const [s1] = await addSources(id, [{ url: "https://n.example/a", title: "A", publisher: null, publishedAt: null, snippet: "old", kind: "news" }]);
    await setSourceTriage(id, [{ id: s1.id, relevance: 0.1, sourceType: "news" }]);
    await discardSources(id, [s1.id]);
    const [r] = await refreshSources(id, [{ url: s1.url, title: null, publisher: null, publishedAt: null, snippet: "new text", kind: "monitor", refresh: true }]);
    expect(r).toMatchObject({ id: s1.id, relevance: null, sourceType: null, snippet: "new text" });
    expect((await listSources(id)).map((s) => s.id)).toEqual([s1.id]);
  });

  it("checkpoints monitor changes only forwards and remembers their ids", async () => {
    const { id } = await createBoard("Checkpoint board here", null);
    await saveMonitor({ id: "mon_c", boardId: id, kind: "search", target: "q", webhookSecret: null, configHash: "h".repeat(64), scheduleMinutes: 10 });
    expect(await monitorById("mon_c")).toMatchObject({ configHash: "h".repeat(64), scheduleMinutes: 10, remoteStatus: "active", lastSeenChangeAt: null });
    await ackMonitorChanges([
      { id: "chg_1", monitorId: "mon_c", detectedAt: "2026-11-14T11:00:00Z" },
      { id: "chg_2", monitorId: "mon_c", detectedAt: "2026-11-14T12:00:00Z" },
    ]);
    expect((await monitorById("mon_c"))?.lastSeenChangeAt).toBe("2026-11-14T12:00:00Z");
    await ackMonitorChanges([{ id: "chg_0", monitorId: "mon_c", detectedAt: "2026-11-14T09:00:00Z" }, { id: "chg_1", monitorId: "mon_c", detectedAt: "2026-11-14T11:00:00Z" }]);
    expect((await monitorById("mon_c"))?.lastSeenChangeAt).toBe("2026-11-14T12:00:00Z");
    expect([...(await seenChangeIds(["chg_0", "chg_1", "chg_2", "chg_9"]))].sort()).toEqual(["chg_0", "chg_1", "chg_2"]);
    await updateMonitorRow("mon_c", { remoteStatus: "dead", lastError: "HTTP 503", checkedAt: 5, target: "q2" });
    expect(await monitorById("mon_c")).toMatchObject({ remoteStatus: "dead", lastError: "HTTP 503", checkedAt: 5, target: "q2" });
    await markMonitorsSynced(id, 123);
    expect((await getBoard(id))?.monitorsSyncedAt).toBe(123);
  });

  it("stores each webhook event id once, and can forget it", async () => {
    expect(await recordWebhookEvent({ eventId: "evt_x", monitorId: "mon_c", event: "change.detected" })).toBe(true);
    expect(await recordWebhookEvent({ eventId: "evt_x", monitorId: "mon_c", event: "change.detected" })).toBe(false);
    await forgetWebhookEvent("evt_x");
    expect(await recordWebhookEvent({ eventId: "evt_x", monitorId: "mon_c", event: "change.detected" })).toBe(true);
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
