import { NotFoundError } from "context.dev";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitorRow } from "./repo/boards";
import type { Plan } from "./spec";
import { quoteInText } from "./pipeline/verify";

const rows: MonitorRow[] = [];
const seen = new Set<string>();
const allowance = { search: true, page: true };
vi.mock("./repo/topics", () => ({ monitorAllowance: vi.fn(async () => allowance) }));
vi.mock("./repo/boards", () => ({
  listMonitors: vi.fn(async (boardId?: string) => rows.filter((r) => !boardId || r.boardId === boardId)),
  saveMonitor: vi.fn(async (m: Partial<MonitorRow> & Pick<MonitorRow, "id" | "boardId" | "kind" | "target" | "webhookSecret">) => {
    rows.push(row({ ...m, remoteStatus: "active" }));
  }),
  updateMonitorRow: vi.fn(async (id: string, p: Partial<MonitorRow>) => {
    const r = rows.find((x) => x.id === id);
    if (r) Object.assign(r, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  }),
  deleteMonitorRow: vi.fn(async (id: string) => {
    const i = rows.findIndex((x) => x.id === id);
    if (i >= 0) rows.splice(i, 1);
  }),
  seenChangeIds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => seen.has(id)))),
  ackMonitorChanges: vi.fn(async (changes: { id: string; monitorId: string; detectedAt: string }[]) => {
    for (const c of changes) {
      seen.add(c.id);
      const r = rows.find((x) => x.id === c.monitorId);
      if (r && (!r.lastSeenChangeAt || c.detectedAt > r.lastSeenChangeAt)) r.lastSeenChangeAt = c.detectedAt;
    }
  }),
}));

function row(p: Partial<MonitorRow> & Pick<MonitorRow, "id">): MonitorRow {
  return {
    boardId: "b1",
    kind: "search",
    target: "q",
    lastSeenChangeAt: null,
    webhookSecret: null,
    configHash: null,
    scheduleMinutes: null,
    remoteStatus: null,
    lastError: null,
    checkedAt: null,
    createdAt: Date.parse("2026-11-14T08:00:00Z"),
    ...p,
  };
}

const { __setContextClientForTest } = await import("./contextdev");
const {
  ackChanges,
  changeDocs,
  collectMonitorChanges,
  configHash,
  ensureBoardMonitors,
  fetchChangeTexts,
  removeBoardMonitors,
  setBoardMonitorSchedule,
  syncBoardMonitors,
} = await import("./monitors");

const plan = { title: "Valencia Floods", monitor: { query: "Valencia flood news", instructions: "New deaths, evacuations, warnings" } } as Plan;
const HOOK = { url: "https://api.faraday.watch/api/webhooks/context", events: ["change.detected"], retry: {} };

function client(limit = 10, used = 0) {
  let n = 0;
  const remote = (id: string, status = "active") => ({ id, status, last_error: null, webhook: null, webhook_failure: null });
  return {
    monitors: {
      getLimits: vi.fn(async () => ({ monitors_limit: limit, monitors_used: used })),
      create: vi.fn(async () => ({ id: `m${++n}`, webhook: { secret: `sec${n}` } })),
      update: vi.fn(async (id: string, _p: Record<string, unknown>) => remote(id) as Record<string, unknown>),
      retrieve: vi.fn(async (id: string) => remote(id) as Record<string, unknown>),
      listRuns: vi.fn(async (_id: string, _q?: unknown) => ({ data: [] as Record<string, unknown>[] })),
      delete: vi.fn(async (_id: string) => ({})),
      run: vi.fn(async () => ({})),
      listChanges: vi.fn(async (_id: string, _q?: unknown, _o?: unknown) => ({ data: [] as unknown[], has_more: false, next_cursor: null as string | null })),
    },
    web: { scrape: vi.fn(async (_p: Record<string, unknown>) => ({ markdown: { success: true, data: "# Status\n480 of 500 sites are operational." } })) },
  };
}

const change = (id: string, detected_at: string, extra: Record<string, unknown> = {}) => ({
  id,
  detected_at,
  title: `Change ${id}`,
  summary: "",
  url: `https://n.example/${id}`,
  evidence: [],
  ...extra,
});

describe("monitors", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    rows.length = 0;
    seen.clear();
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    delete process.env.FARADAY_MONITORS;
    process.env.FARADAY_DOMAIN = "faraday.watch";
  });
  afterEach(() => {
    process.env.FARADAY_DOMAIN = saved.FARADAY_DOMAIN;
    __setContextClientForTest(undefined);
  });

  it("creates a search monitor and up to two page monitors with the retrying webhook", async () => {
    const c = client();
    __setContextClientForTest(c);
    const note = await ensureBoardMonitors("b1", plan, ["https://gov.example/a#x", "https://gov.example/a", "ftp://nope", "https://aemet.es/b", "https://third.example"]);
    expect(c.monitors.create).toHaveBeenCalledTimes(3);
    const calls = c.monitors.create.mock.calls as unknown as [Record<string, any>][];
    expect(calls[0][0].target).toMatchObject({ type: "search", query: "Valencia flood news" });
    expect(calls[1][0].target).toEqual({ type: "page", url: "https://gov.example/a", instructions: plan.monitor.instructions });
    expect(calls[0][0].webhook).toEqual(HOOK);
    expect(calls[0][0].schedule).toEqual({ type: "interval", frequency: 10, unit: "minutes" });
    expect(calls[0][0].tags).toEqual(["faraday", "board:b1"]);
    expect(rows.map((r) => [r.kind, r.target, r.webhookSecret, r.scheduleMinutes])).toEqual([
      ["search", "Valencia flood news", "sec1", 10],
      ["page", "https://gov.example/a", "sec2", 10],
      ["page", "https://aemet.es/b", "sec3", 10],
    ]);
    expect(rows[0].configHash).toBe(configHash({ type: "search", query: plan.monitor.query, instructions: plan.monitor.instructions }));
    expect(note).toContain("search monitor m1");
    expect(await ensureBoardMonitors("b1", plan, ["https://gov.example/a"])).toBe("monitors already running");
  });

  it("schedules by tier: a cold board's monitors run every two hours", async () => {
    const c = client();
    __setContextClientForTest(c);
    await ensureBoardMonitors("b1", plan, [], { tier: "cold" });
    expect((c.monitors.create.mock.calls as unknown as [Record<string, any>][])[0][0].schedule).toEqual({ type: "interval", frequency: 2, unit: "hours" });
  });

  it("respects the account allowance and allowPage=false", async () => {
    const c = client(10, 9);
    __setContextClientForTest(c);
    const note = await ensureBoardMonitors("b2", plan, ["https://gov.example/a"]);
    expect(c.monitors.create).toHaveBeenCalledTimes(1);
    expect(note).toContain("no allowance left");
    const c2 = client();
    __setContextClientForTest(c2);
    rows.length = 0;
    await ensureBoardMonitors("b3", plan, ["https://gov.example/a"], { allowPage: false });
    expect(c2.monitors.create).toHaveBeenCalledTimes(1);
  });

  it("gives a dead page monitor's slot to another URL and does not watch the dead URL again", async () => {
    rows.push(row({ id: "s", kind: "search", target: plan.monitor.query, remoteStatus: "active" }), row({ id: "p", kind: "page", target: "https://gov.example/a", remoteStatus: "dead" }));
    const c = client();
    __setContextClientForTest(c);
    await ensureBoardMonitors("b1", plan, ["https://gov.example/a", "https://aemet.es/b"]);
    const targets = (c.monitors.create.mock.calls as unknown as [Record<string, any>][]).map((x) => x[0].target.url);
    expect(targets).toEqual(["https://aemet.es/b"]);
  });

  it("is a no-op when monitors are disabled", async () => {
    process.env.FARADAY_MONITORS = "off";
    const c = client();
    __setContextClientForTest(c);
    expect(await ensureBoardMonitors("b1", plan, [])).toBe("monitors disabled");
    expect(c.monitors.getLimits).not.toHaveBeenCalled();
  });

  it("removes monitors, treating 404 as gone and keeping rows on other errors", async () => {
    rows.push(row({ id: "a" }), row({ id: "b", kind: "page", target: "u" }), row({ id: "c", kind: "page", target: "v" }), row({ id: "d", kind: "page", target: "w", remoteStatus: "dead" }));
    const c = client();
    c.monitors.delete.mockImplementation(async (id: string) => {
      if (id === "b") throw new NotFoundError(404, undefined, "gone", new Headers());
      if (id === "c") throw new Error("network");
      return {};
    });
    __setContextClientForTest(c);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await removeBoardMonitors("b1")).toBe(3);
    expect(rows.map((r) => r.id)).toEqual(["c"]);
    expect(c.monitors.delete).not.toHaveBeenCalledWith("d");
  });

  it("reads every page since the checkpoint, skips processed ids, and moves the checkpoint only on ack", async () => {
    rows.push(row({ id: "m1", lastSeenChangeAt: "2026-11-14T10:00:00Z" }));
    seen.add("c0");
    const c = client();
    c.monitors.listChanges
      .mockResolvedValueOnce({
        data: [change("c3", "2026-11-14T12:00:00Z", { importance: "high" }), change("c2", "2026-11-14T11:00:00Z")],
        has_more: true,
        next_cursor: "cur1",
      })
      .mockResolvedValueOnce({ data: [change("c1", "2026-11-14T10:30:00Z"), change("c0", "2026-11-14T10:00:00Z")], has_more: false, next_cursor: null });
    __setContextClientForTest(c);
    const { changes, calls } = await collectMonitorChanges("b1");
    expect(calls).toBe(2);
    const q = c.monitors.listChanges.mock.calls.map((x) => x[1]);
    // 10 minutes of overlap before the checkpoint; the second page follows the cursor.
    expect(q).toEqual([
      { limit: 100, since: "2026-11-14T09:50:00.000Z" },
      { limit: 100, since: "2026-11-14T09:50:00.000Z", cursor: "cur1" },
    ]);
    expect(changes.map((x) => x.id)).toEqual(["c3", "c2", "c1"]);
    expect(changes[0].importance).toBe("high");
    expect(rows[0].lastSeenChangeAt).toBe("2026-11-14T10:00:00Z");

    await ackChanges(changes);
    expect(rows[0].lastSeenChangeAt).toBe("2026-11-14T12:00:00Z");
    c.monitors.listChanges.mockResolvedValueOnce({ data: [change("c3", "2026-11-14T12:00:00Z")], has_more: false, next_cursor: null });
    expect((await collectMonitorChanges("b1")).changes).toEqual([]);
  });

  it("without a checkpoint reads from the monitor's creation", async () => {
    rows.push(row({ id: "m1" }));
    const c = client();
    __setContextClientForTest(c);
    await collectMonitorChanges("b1");
    expect(c.monitors.listChanges.mock.calls[0][1]).toEqual({ limit: 100, since: "2026-11-14T07:50:00.000Z" });
  });

  it("turns a change into raw-text docs only: the judge's summary never becomes evidence", async () => {
    rows.push(row({ id: "m1", kind: "page", target: "https://status.example/incident" }));
    const c = client();
    c.monitors.listChanges.mockResolvedValueOnce({
      data: [
        change("c1", "2026-11-14T10:00:00Z", {
          title: "Service restored",
          summary: "All 500 sites are operational.",
          url: "https://status.example/incident",
          evidence: [
            { after: "480 of 500 sites are operational.", before: "300 of 500 sites are operational." },
            { url: "https://status.example/region", after: "North: 120 sites up", before: "" },
          ],
        }),
      ],
      has_more: false,
      next_cursor: null,
    });
    __setContextClientForTest(c);
    const [ch] = (await collectMonitorChanges("b1")).changes;
    const docs = changeDocs(ch);
    expect(docs).toEqual([
      { url: "https://status.example/incident", title: null, publisher: "status.example", publishedAt: "2026-11-14T10:00:00Z", snippet: "480 of 500 sites are operational.", kind: "monitor", refresh: true },
      { url: "https://status.example/region", title: null, publisher: "status.example", publishedAt: "2026-11-14T10:00:00Z", snippet: "North: 120 sites up", kind: "monitor", refresh: true },
    ]);
    const corpus = docs.map((d) => `${d.title ?? ""}\n${d.snippet ?? ""}`).join("\n");
    expect(quoteInText("All 500 sites are operational.", corpus)).toBe(false);
    expect(quoteInText("480 of 500 sites are operational.", corpus)).toBe(true);
  });

  it("falls back to the after-text excerpt, then to a fresh scrape of the changed page", async () => {
    const base = { id: "c", monitorId: "m1", detectedAt: "2026-11-14T10:00:00Z", title: "t", summary: "model text", importance: null, evidence: [] };
    expect(changeDocs({ ...base, url: "https://a.example/", afterExcerpt: "raw excerpt" })[0].snippet).toBe("raw excerpt");
    const bare = changeDocs({ ...base, url: "https://b.example/", afterExcerpt: null });
    expect(bare).toMatchObject([{ url: "https://b.example/", snippet: null, refresh: true }]);
    const c = client();
    __setContextClientForTest(c);
    const filled = await fetchChangeTexts(bare);
    expect(filled.calls).toBe(1);
    expect(filled.docs[0].snippet).toContain("480 of 500 sites are operational.");
    expect(c.web.scrape.mock.calls[0][0]).toMatchObject({ url: "https://b.example/", maxAgeMs: 0 });
  });

  describe("sync", () => {
    const searchHash = configHash({ type: "search", query: plan.monitor.query, instructions: plan.monitor.instructions }, HOOK as never);
    const now = Date.parse("2026-11-14T12:00:00Z");

    it("leaves an up-to-date, recently checked monitor alone", async () => {
      rows.push(row({ id: "s", target: plan.monitor.query, configHash: searchHash, scheduleMinutes: 10, remoteStatus: "active", checkedAt: now - 60_000 }));
      const c = client();
      __setContextClientForTest(c);
      expect(await syncBoardMonitors("b1", plan, "hot", { now })).toEqual({ notes: [], alerts: [] });
      expect(c.monitors.update).not.toHaveBeenCalled();
      expect(c.monitors.retrieve).not.toHaveBeenCalled();
    });

    it("adds the retrying webhook to monitors from before config hashes without resetting their baseline", async () => {
      rows.push(row({ id: "s", target: plan.monitor.query, scheduleMinutes: 10 }));
      const c = client();
      __setContextClientForTest(c);
      await syncBoardMonitors("b1", plan, "hot", { now });
      expect(c.monitors.update).toHaveBeenCalledWith("s", { webhook: HOOK });
      expect(rows[0]).toMatchObject({ configHash: searchHash, remoteStatus: "active", checkedAt: now });
    });

    it("sends the edited query and instructions, and the tier's schedule", async () => {
      rows.push(row({ id: "s", target: plan.monitor.query, configHash: searchHash, scheduleMinutes: 10, remoteStatus: "active", checkedAt: now }));
      const edited = { ...plan, monitor: { query: "Valencia flood shelters", instructions: "Shelter openings and closures" } } as Plan;
      const c = client();
      __setContextClientForTest(c);
      await syncBoardMonitors("b1", edited, "warm", { now });
      expect(c.monitors.update).toHaveBeenCalledWith("s", {
        target: { type: "search", query: "Valencia flood shelters", instructions: "Shelter openings and closures" },
        schedule: { type: "interval", frequency: 30, unit: "minutes" },
      });
      expect(rows[0]).toMatchObject({ target: "Valencia flood shelters", scheduleMinutes: 30 });
    });

    it("deletes a page monitor Context.dev failed and marks its URL dead", async () => {
      const hash = configHash({ type: "page", url: "https://gov.example/a", instructions: plan.monitor.instructions }, HOOK as never);
      rows.push(row({ id: "p", kind: "page", target: "https://gov.example/a", configHash: hash, scheduleMinutes: 10, remoteStatus: "active" }));
      const c = client();
      c.monitors.retrieve.mockResolvedValueOnce({ id: "p", status: "failed", last_error: { message: "HTTP 503" } });
      c.monitors.listRuns.mockResolvedValueOnce({ data: [{ status: "failed", error: { message: "HTTP 503 from origin" } }] });
      __setContextClientForTest(c);
      const r = await syncBoardMonitors("b1", plan, "hot", { now });
      expect(c.monitors.delete).toHaveBeenCalledWith("p");
      expect(rows[0]).toMatchObject({ remoteStatus: "dead", lastError: "HTTP 503 from origin" });
      expect(r.alerts[0]).toContain("Stopped watching gov.example");
    });

    it("reports runs skipped for credits without deleting, and resumes a paused search monitor once", async () => {
      rows.push(row({ id: "s", target: plan.monitor.query, configHash: searchHash, scheduleMinutes: 10, remoteStatus: "active" }));
      const c = client();
      c.monitors.retrieve.mockResolvedValue({ id: "s", status: "paused", last_error: null });
      c.monitors.listRuns.mockResolvedValueOnce({ data: [{ status: "skipped", skip_reason: "insufficient_credits" }] });
      __setContextClientForTest(c);
      const r1 = await syncBoardMonitors("b1", plan, "hot", { now });
      expect(r1.alerts[0]).toContain("credits ran out");
      expect(c.monitors.delete).not.toHaveBeenCalled();
      expect(c.monitors.update).not.toHaveBeenCalled();

      rows[0].remoteStatus = "active";
      c.monitors.listRuns.mockResolvedValue({ data: [{ status: "failed", error: { message: "search backend error" } }] });
      const r2 = await syncBoardMonitors("b1", plan, "hot", { now, force: true });
      expect(c.monitors.update).toHaveBeenCalledWith("s", { status: "active" });
      expect(r2.alerts[0]).toContain("Restarted the news search monitor");
      // Same failure again: not resumed a second time.
      rows[0].remoteStatus = "active";
      await syncBoardMonitors("b1", plan, "hot", { now, force: true });
      expect(c.monitors.update).toHaveBeenCalledTimes(1);
    });

    it("drops the row of a monitor that no longer exists so it is recreated", async () => {
      rows.push(row({ id: "s", target: plan.monitor.query, configHash: searchHash, scheduleMinutes: 10 }));
      const c = client();
      c.monitors.retrieve.mockRejectedValueOnce(new NotFoundError(404, undefined, "gone", new Headers()));
      __setContextClientForTest(c);
      await syncBoardMonitors("b1", plan, "hot", { now });
      expect(rows).toEqual([]);
    });

    it("updates schedules when the tier changes", async () => {
      rows.push(row({ id: "s", scheduleMinutes: 10 }), row({ id: "p", kind: "page", target: "u", scheduleMinutes: 10, remoteStatus: "dead" }));
      const c = client();
      __setContextClientForTest(c);
      expect(await setBoardMonitorSchedule("b1", "cold")).toBe(1);
      expect(c.monitors.update).toHaveBeenCalledWith("s", { schedule: { type: "interval", frequency: 2, unit: "hours" } });
      expect(rows[0].scheduleMinutes).toBe(120);
      expect(await setBoardMonitorSchedule("b1", "cold")).toBe(0);
    });
  });
});
