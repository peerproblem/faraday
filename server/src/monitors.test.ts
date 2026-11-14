import { NotFoundError } from "context.dev";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitorRow } from "./repo/boards";
import type { Plan } from "./spec";

const rows: MonitorRow[] = [];
vi.mock("./repo/boards", () => ({
  listMonitors: vi.fn(async (boardId?: string) => rows.filter((r) => !boardId || r.boardId === boardId)),
  saveMonitor: vi.fn(async (m: Omit<MonitorRow, "lastSeenChangeAt">) => {
    rows.push({ ...m, lastSeenChangeAt: null });
  }),
  setMonitorSeen: vi.fn(async (id: string, at: string) => {
    const r = rows.find((x) => x.id === id);
    if (r) r.lastSeenChangeAt = at;
  }),
  deleteMonitorRow: vi.fn(async (id: string) => {
    const i = rows.findIndex((x) => x.id === id);
    if (i >= 0) rows.splice(i, 1);
  }),
}));

const { __setContextClientForTest } = await import("./contextdev");
const { collectMonitorChanges, ensureBoardMonitors, removeBoardMonitors, changeDocs } = await import("./monitors");

const plan = { title: "Valencia Floods", monitor: { query: "Valencia flood news", instructions: "New deaths, evacuations, warnings" } } as Plan;

function client(limit = 10, used = 0) {
  let n = 0;
  return {
    monitors: {
      getLimits: vi.fn(async () => ({ monitors_limit: limit, monitors_used: used })),
      create: vi.fn(async () => ({ id: `m${++n}`, webhook: { secret: `sec${n}` } })),
      delete: vi.fn(async (_id: string) => ({})),
      run: vi.fn(async () => ({})),
      listChanges: vi.fn(async () => ({ data: [] as unknown[] })),
    },
  };
}

describe("monitors", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    rows.length = 0;
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    delete process.env.FARADAY_MONITORS;
    process.env.FARADAY_DOMAIN = "faraday.watch";
  });
  afterEach(() => {
    process.env.FARADAY_DOMAIN = saved.FARADAY_DOMAIN;
    __setContextClientForTest(undefined);
  });

  it("creates a search monitor and up to two page monitors with the webhook", async () => {
    const c = client();
    __setContextClientForTest(c);
    const note = await ensureBoardMonitors("b1", plan, ["https://gov.example/a#x", "https://gov.example/a", "ftp://nope", "https://aemet.es/b", "https://third.example"]);
    expect(c.monitors.create).toHaveBeenCalledTimes(3);
    const calls = c.monitors.create.mock.calls as unknown as [Record<string, any>][];
    expect(calls[0][0].target).toMatchObject({ type: "search", query: "Valencia flood news" });
    expect(calls[1][0].target).toEqual({ type: "page", url: "https://gov.example/a", instructions: plan.monitor.instructions });
    expect(calls[0][0].webhook).toEqual({ url: "https://api.faraday.watch/api/webhooks/context", events: ["change.detected"] });
    expect(calls[0][0].schedule).toEqual({ type: "interval", frequency: 10, unit: "minutes" });
    expect(rows.map((r) => [r.kind, r.target, r.webhookSecret])).toEqual([
      ["search", "Valencia flood news", "sec1"],
      ["page", "https://gov.example/a", "sec2"],
      ["page", "https://aemet.es/b", "sec3"],
    ]);
    expect(note).toContain("search monitor m1");
    expect(await ensureBoardMonitors("b1", plan, ["https://gov.example/a"])).toBe("monitors already running");
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

  it("is a no-op when monitors are disabled", async () => {
    process.env.FARADAY_MONITORS = "off";
    const c = client();
    __setContextClientForTest(c);
    expect(await ensureBoardMonitors("b1", plan, [])).toBe("monitors disabled");
    expect(c.monitors.getLimits).not.toHaveBeenCalled();
  });

  it("removes monitors, treating 404 as gone and keeping rows on other errors", async () => {
    rows.push(
      { id: "a", boardId: "b1", kind: "search", target: "q", lastSeenChangeAt: null, webhookSecret: null },
      { id: "b", boardId: "b1", kind: "page", target: "u", lastSeenChangeAt: null, webhookSecret: null },
      { id: "c", boardId: "b1", kind: "page", target: "v", lastSeenChangeAt: null, webhookSecret: null },
    );
    const c = client();
    c.monitors.delete.mockImplementation(async (id: string) => {
      if (id === "b") throw new NotFoundError(404, undefined, "gone", new Headers());
      if (id === "c") throw new Error("network");
      return {};
    });
    __setContextClientForTest(c);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await removeBoardMonitors("b1")).toBe(2);
    expect(rows.map((r) => r.id)).toEqual(["c"]);
  });

  it("collects only changes newer than the last seen one and advances it", async () => {
    rows.push({ id: "m1", boardId: "b1", kind: "search", target: "q", lastSeenChangeAt: "2026-11-14T10:00:00Z", webhookSecret: null });
    const c = client();
    c.monitors.listChanges.mockResolvedValue({
      data: [
        { detected_at: "2026-11-14T12:00:00Z", title: "New warning", summary: "Red alert", url: "https://aemet.es/x", importance: "high", evidence: [{ url: "https://aemet.es/y", after: "Red alert issued", before: "" }, { after: "no url", before: "" }] },
        { detected_at: "2026-11-14T11:00:00Z", title: "Older", summary: "", url: "https://n.example", evidence: [] },
        { detected_at: "2026-11-14T09:00:00Z", title: "Seen", summary: "", url: "https://seen.example", evidence: [] },
      ],
    });
    __setContextClientForTest(c);
    const { changes, calls } = await collectMonitorChanges("b1");
    expect(calls).toBe(1);
    expect(changes.map((x) => x.title)).toEqual(["New warning", "Older"]);
    expect(changes[0].importance).toBe("high");
    expect(changes[0].evidence).toEqual([
      { url: "https://aemet.es/y", title: null, publisher: "aemet.es", publishedAt: "2026-11-14T12:00:00Z", snippet: "Red alert issued", kind: "monitor" },
    ]);
    expect(rows[0].lastSeenChangeAt).toBe("2026-11-14T12:00:00Z");
    expect(changeDocs(changes[0])[0]).toMatchObject({ url: "https://aemet.es/x", kind: "monitor", snippet: "Red alert" });
  });
});
