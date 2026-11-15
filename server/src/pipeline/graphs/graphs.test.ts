import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCtx } from "../../graph/runner";
import type { Job } from "../../repo/jobs";
import type { BoardData, FactDiff, Plan, Source, StreamMsg } from "../../spec";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { object: (x: unknown) => x },
}));
vi.mock("../../llm/decide", () => ({ decide: vi.fn() }));
vi.mock("../../llm/models", () => ({
  fastLlm: () => ({ model: "fast-model", modelId: "fast" }),
  smartLlm: () => ({ model: "smart-model", modelId: "smart" }),
  planLlm: () => ({ model: "plan-model", modelId: "plan" }),
  GROUNDING_RULES: "rules",
}));
vi.mock("../../repo/boards", () => ({
  getBoard: vi.fn(),
  listSources: vi.fn(),
  addSources: vi.fn(),
  refreshSources: vi.fn(async () => []),
  markMonitorsSynced: vi.fn(),
  setSourceTriage: vi.fn(),
  setSourceLanguage: vi.fn(),
  getSources: vi.fn(async () => []),
  discardSources: vi.fn(),
  markExtracted: vi.fn(),
  getSourceTexts: vi.fn(async () => new Map()),
  saveSourceText: vi.fn(),
  listMonitors: vi.fn(),
  markPolled: vi.fn(),
  markChanged: vi.fn(),
  saveBoardVersion: vi.fn(async () => 7),
  setStatus: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
  savePlan: vi.fn(),
  setSchedule: vi.fn(),
}));
vi.mock("../../repo/facts", () => ({
  listFacts: vi.fn(async () => []),
  metricHistory: vi.fn(async () => []),
  applyMerge: vi.fn(async () => []),
  saveRejected: vi.fn(),
  updatePlaceCoords: vi.fn(),
}));
vi.mock("../../repo/geocode", () => ({ getCachedGeocode: vi.fn(async () => ({ lat: 1, lon: 2, displayName: "x" })), putCachedGeocode: vi.fn() }));
vi.mock("../../contextdev", () => ({ searchNews: vi.fn(), searchWeb: vi.fn(), scrapeMarkdown: vi.fn(async () => null) }));
// The root .env may hold an Oxylabs key; these suites must never reach the network.
vi.mock("../../oxylabs", () => ({ oxylabsEnabled: () => false, oxySearch: vi.fn(async () => []), oxyScrape: vi.fn(async () => null) }));
vi.mock("../../monitors", () => ({
  collectMonitorChanges: vi.fn(async () => ({ changes: [], calls: 0 })),
  ensureBoardMonitors: vi.fn(async () => "search monitor m1"),
  syncBoardMonitors: vi.fn(async () => ({ notes: [], alerts: [] })),
  ackChanges: vi.fn(),
  fetchChangeTexts: vi.fn(async (docs: unknown[]) => ({ docs, calls: 0 })),
  MONITOR_SYNC_MS: 30 * 60_000,
  changeDocs: vi.fn(() => []),
}));
vi.mock("../verify", () => ({
  verifyFacts: vi.fn(({ facts }: { facts: unknown[] }) => ({
    accepted: facts.map((f) => ({ ...(f as object), sourceType: null, relevance: 0.9, valueNum: null })),
    rejected: [],
  })),
}));
let mergeDiff: FactDiff = { added: [], changed: [], superseded: 0 };
vi.mock("../merge", () => ({ mergeFacts: vi.fn(() => ({ insert: [], supersede: [], addSources: [], diff: mergeDiff })) }));
const DATA = (headline: string): BoardData => ({
  header: { title: "T", subtitle: null, crisisType: "flood", accent: "blue", headline: { text: headline, sources: [] }, status: null, statusP: null, severity: null, severityP: null, location: null, asOf: null, language: "en" },
  widgets: { w1: { sentences: [] }, w2: { items: [] } },
  hidden: [],
  generatedAt: 0,
});
vi.mock("../assemble", () => ({
  specFromPlan: vi.fn(() => ({ version: 2, widgets: [{ id: "w1", type: "narrative", title: "S", span: "full", bind: null, metrics: [] }] })),
  assemble: vi.fn((i: { spec: unknown }) => ({ spec: i.spec, data: DATA("new") })),
  diffData: vi.fn(() => ({ widgets: ["w2"], header: true, hidden: false })),
}));

const ai = await import("ai");
const { decide } = await import("../../llm/decide");
const boards = await import("../../repo/boards");
const { scrapeMarkdown, searchNews, searchWeb } = await import("../../contextdev");
const monitors = await import("../../monitors");
const { buildGraph, updateGraph } = await import("./index");

const plan: Plan = {
  title: "Valencia Floods",
  subtitle: null,
  crisisType: "flood",
  language: "en",
  location: { name: "Valencia, Spain", zoom: 9 },
  lookbackDays: 7,
  entities: ["Valencia"],
  newsQueries: ["valencia floods"],
  webQueries: ["valencia shelters"],
  monitor: { query: "valencia floods", instructions: "new figures" },
  metrics: [{ key: "deaths", label: "Deaths", unit: null, why: "" }],
  tables: [],
  statusGroups: [],
  questions: [{ id: "q1", text: "How many died?" }],
  widgets: [],
};

const source = (id: string, over: Partial<Source> = {}): Source => ({
  id,
  url: `https://x.com/${id}`,
  title: id,
  publisher: "x.com",
  kind: "news",
  publishedAt: null,
  fetchedAt: 0,
  snippet: "s",
  relevance: null,
  sourceType: null,
  ...over,
});

const board = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  slug: "s",
  ownerId: null,
  prompt: "p",
  title: "T",
  status: "live",
  tier: "hot",
  visibility: "public",
  plan,
  specVersion: 2,
  spec: { version: 2, widgets: [{ id: "w1", type: "narrative", title: "S", span: "full", bind: null, metrics: [] }] },
  data: DATA("old"),
  version: 3,
  language: "en",
  lastPolledAt: Date.now() - 60_000,
  nextPollAt: null,
  lastViewedAt: null,
  lastChangedAt: null,
  runningJobId: 1,
  monitorsSyncedAt: Date.now() - 60_000,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function fakeCtx(kind: Job["kind"], payload: Record<string, unknown> | null = null) {
  const steps: string[] = [];
  const emitted: StreamMsg[] = [];
  const use = { llm: vi.fn(), context: vi.fn() };
  const signal = new AbortController().signal;
  const ctx: RunCtx = {
    boardId: "b1",
    runId: 1,
    job: { id: 1, kind, boardId: "b1", payload, status: "running", priority: 0, attempts: 1, maxAttempts: 3, runAfter: 0, createdAt: 0 },
    signal,
    deadline: Date.now() + 600_000,
    async step(node, input, fn, opts) {
      steps.push(opts.key ? `${node}[${opts.key}]` : node);
      try {
        return await fn(input, use, signal);
      } catch (e) {
        if (opts.optional) return opts.fallback as never;
        throw e;
      }
    },
    map: (items, _limit, fn) => Promise.all(items.map(fn)),
    emit: (m) => void emitted.push(m),
    async event(kind, message, data) {
      const e = { id: emitted.length, ts: 0, kind, message, data: data ?? null };
      emitted.push({ type: "event", event: e });
      return e;
    },
  };
  return { ctx, steps, emitted };
}

const triageAnswer = (p: number) => ({
  answers: { onTopic: { type: "boolean", probability: p }, type: { type: "choice", choice: "news", probabilities: {} }, hasFacts: { type: "boolean", probability: 0.5 } },
  backend: "google",
  model: "gemini-decision-1",
  ms: 1,
  tokensIn: 10,
});

function routeDecide() {
  vi.mocked(decide).mockImplementation((async (_state: unknown, q: Record<string, unknown>) => {
    if ("onTopic" in q) return triageAnswer(0.9);
    if ("answered" in q) return { answers: { answered: { type: "boolean", probability: 0.9 } }, backend: "google", model: "d", ms: 1, tokensIn: 1 };
    if ("severity" in q)
      return { answers: { severity: { type: "score", score: 2, probabilities: {} }, status: { type: "choice", choice: "ongoing", probabilities: {} } }, backend: "google", model: "d", ms: 1, tokensIn: 1 };
    if ("material" in q) return { answers: { material: { type: "boolean", probability: 0.9 }, importance: { type: "score", score: 2, probabilities: {} } }, backend: "google", model: "d", ms: 1, tokensIn: 1 };
    throw new Error(`unexpected decision ${Object.keys(q)}`);
  }) as never);
}

function routeLlm() {
  vi.mocked(ai.generateText).mockImplementation((async (args: { system?: string }) => {
    const sys = args.system ?? "";
    if (sys.includes("You plan live")) return { output: plan, usage: {} };
    if (sys.includes("You extract facts"))
      return {
        output: { facts: [{ kind: "metric", key: "deaths", sourceId: "s1", quote: "12 died", asOf: null, valueText: "12", valueNum: 12 }] },
        usage: { inputTokens: 5, outputTokens: 5 },
      };
    if (sys.includes("change log")) return { text: "Deaths rose", usage: {} };
    throw new Error(`unexpected generateText: ${sys.slice(0, 40)}`);
  }) as never);
  vi.mocked(ai.streamText).mockImplementation((() => ({
    partialOutputStream: (async function* () {})(),
    output: Promise.resolve({ headline: { text: "h", facts: [] }, sentences: [{ text: "s", facts: [] }] }),
    usage: Promise.resolve({}),
  })) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mergeDiff = { added: [], changed: [], superseded: 0 };
  routeDecide();
  routeLlm();
  vi.mocked(boards.getBoard).mockResolvedValue(board() as never);
  vi.mocked(boards.listMonitors).mockResolvedValue([{ id: "m1" }] as never);
  vi.mocked(boards.listSources).mockResolvedValue([]);
  vi.mocked(searchNews).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue([]);
});

describe("updateGraph", () => {
  it("makes no model calls when nothing new arrived", async () => {
    vi.mocked(boards.addSources).mockResolvedValue([]);
    const { ctx, steps, emitted } = fakeCtx("poll", { reason: "schedule" });
    await updateGraph(ctx);
    expect(steps).toEqual(["collect"]);
    expect(decide).not.toHaveBeenCalled();
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.streamText).not.toHaveBeenCalled();
    const lastPolledAt = vi.mocked(boards.markPolled).mock.calls[0]?.[1];
    expect(lastPolledAt).toEqual(expect.any(Number));
    expect(emitted).toContainEqual({ type: "polled", lastPolledAt });
    expect(boards.saveBoardVersion).not.toHaveBeenCalled();
  });

  it("stops after merge with an empty diff: only triage and extraction ran", async () => {
    const fresh = source("s1");
    vi.mocked(boards.addSources).mockResolvedValue([fresh]);
    vi.mocked(boards.listSources).mockImplementation((async () => [{ ...fresh, relevance: vi.mocked(decide).mock.calls.length ? 0.9 : null }]) as never);
    const { ctx, steps } = fakeCtx("poll", { reason: "manual" });
    await updateGraph(ctx);
    expect(steps).toEqual(["collect", "triage[u1]", "extract[u1-b0]", "merge[u1]"]);
    expect(vi.mocked(decide).mock.calls.every(([, q]) => "onTopic" in (q as object))).toBe(true);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.streamText).not.toHaveBeenCalled();
    expect(boards.saveBoardVersion).not.toHaveBeenCalled();
    expect(boards.markPolled).toHaveBeenCalled();
  });

  it("with a real change: gates, rewrites, saves and streams only changed widgets", async () => {
    mergeDiff = { added: [], changed: [{ kind: "metric", key: "deaths", from: "12", to: "15" }], superseded: 1 };
    const facts = (await import("../../repo/facts")) as unknown as { listFacts: ReturnType<typeof vi.fn> };
    facts.listFacts.mockResolvedValue([{ id: 2, kind: "metric", key: "deaths", payload: { valueText: "15" }, sourceIds: ["s1"], asOf: null, status: "active" }]);
    const fresh = source("s1");
    vi.mocked(boards.addSources).mockResolvedValue([fresh]);
    vi.mocked(boards.listSources).mockImplementation((async () => [{ ...fresh, relevance: vi.mocked(decide).mock.calls.length ? 0.9 : null }]) as never);
    const { ctx, steps, emitted } = fakeCtx("poll", { reason: "schedule" });
    await updateGraph(ctx);
    expect(steps.slice(0, 5)).toEqual(["collect", "triage[u1]", "extract[u1-b0]", "merge[u1]", "materiality"]);
    expect(steps).toEqual(expect.arrayContaining(["narrative", "assess", "note"]));
    expect(ai.streamText).toHaveBeenCalledTimes(1);
    // The single-metric note comes from the template, not the model.
    expect(vi.mocked(ai.generateText).mock.calls.some(([a]) => String((a as { system?: string }).system).includes("change log"))).toBe(false);
    expect(boards.saveBoardVersion).toHaveBeenCalledWith("b1", expect.objectContaining({ changeNote: "Deaths: 12 to 15" }));
    const data = emitted.find((m) => m.type === "data");
    expect(data).toMatchObject({ type: "data", version: 7, widgets: { w2: { items: [] } } });
    expect(Object.keys((data as { widgets: object }).widgets)).toEqual(["w2"]);
    expect(boards.markChanged).toHaveBeenCalled();
    expect(emitted).toContainEqual({
      type: "polled", lastPolledAt: vi.mocked(boards.markPolled).mock.calls[0]?.[1],
    });
    const update = emitted.find((m) => m.type === "event" && m.event.kind === "update");
    expect(update).toBeTruthy();
  });

  it("refreshes a known page a monitor saw change, reads it without cache, re-extracts, then acknowledges the change", async () => {
    const s1 = source("s1", { kind: "web", sourceType: "official", relevance: 0.9, snippet: "480 of 500 sites are operational." });
    const change = {
      id: "chg1",
      monitorId: "m1",
      detectedAt: "2026-11-14T10:00:00Z",
      title: "Service restored",
      summary: "All 500 sites are operational.",
      url: s1.url,
      importance: "high" as const,
      afterExcerpt: null,
      evidence: [{ url: null, after: "480 of 500 sites are operational." }],
    };
    vi.mocked(monitors.collectMonitorChanges).mockResolvedValueOnce({ changes: [change], calls: 1 });
    vi.mocked(monitors.changeDocs).mockReturnValueOnce([
      { url: s1.url, title: null, publisher: "x.com", publishedAt: change.detectedAt, snippet: s1.snippet, kind: "monitor", refresh: true },
    ]);
    vi.mocked(boards.refreshSources).mockResolvedValueOnce([s1]);
    vi.mocked(boards.addSources).mockResolvedValue([]);
    vi.mocked(boards.listSources).mockResolvedValue([s1]);
    const order: string[] = [];
    vi.mocked(monitors.ackChanges).mockImplementation((async () => void order.push("ack")) as never);
    vi.mocked(boards.markPolled).mockImplementation((async () => void order.push("polled")) as never);
    const { ctx, steps, emitted } = fakeCtx("poll", { reason: "webhook" });
    await updateGraph(ctx);
    expect(steps).toEqual(["collect", "read[u1]", "extract[u1-b0]", "merge[u1]"]);
    expect(vi.mocked(scrapeMarkdown).mock.calls[0]).toEqual([s1.url, expect.anything(), { maxAgeMs: 0 }]);
    expect(monitors.ackChanges).toHaveBeenCalledWith([expect.objectContaining({ id: "chg1", monitorId: "m1" })]);
    expect(order).toEqual(["polled", "ack"]);
    expect(emitted).toContainEqual({ type: "sources", added: [s1], discarded: [] });
    // The judge's summary is shown as the change, not stored as a source.
    const ev = emitted.find((m) => m.type === "event" && m.event.kind === "change");
    expect(ev).toMatchObject({ event: { message: "Monitor: Service restored", data: { summary: "All 500 sites are operational." } } });
  });

  it("triages sources stored before the poll (discovery evidence) even when the poll finds nothing new", async () => {
    const waiting = source("s1", { relevance: null });
    vi.mocked(boards.addSources).mockResolvedValue([]);
    vi.mocked(boards.listSources).mockImplementation((async () => [{ ...waiting, relevance: vi.mocked(decide).mock.calls.length ? 0.9 : null }]) as never);
    const { ctx, steps, emitted } = fakeCtx("poll", { reason: "discover" });
    await updateGraph(ctx);
    expect(steps).toContain("triage[u1]");
    expect(vi.mocked(decide).mock.calls.some(([, q]) => "onTopic" in (q as object))).toBe(true);
    expect(emitted.some((m) => m.type === "event" && m.event.message.includes("nothing new"))).toBe(false);
  });

  it("posts no 'nothing new' event for a discover poll with nothing to do", async () => {
    vi.mocked(boards.addSources).mockResolvedValue([]);
    vi.mocked(boards.listSources).mockResolvedValue([source("s1", { relevance: 0.8 })] as never);
    const { ctx, steps, emitted } = fakeCtx("poll", { reason: "discover" });
    await updateGraph(ctx);
    expect(steps).toEqual(["collect"]);
    expect(emitted.some((m) => m.type === "event")).toBe(false);
    expect(boards.markPolled).toHaveBeenCalledWith("b1", expect.any(Number));
  });

  it("acknowledges collected changes when nothing new came of them", async () => {
    const change = { id: "chg2", monitorId: "m1", detectedAt: "2026-11-14T10:00:00Z", title: "t", summary: null, url: "https://x.com/a", importance: null, afterExcerpt: null, evidence: [] };
    vi.mocked(monitors.collectMonitorChanges).mockResolvedValueOnce({ changes: [change], calls: 1 });
    vi.mocked(boards.addSources).mockResolvedValue([]);
    const { ctx } = fakeCtx("poll", { reason: "schedule" });
    await updateGraph(ctx);
    expect(monitors.ackChanges).toHaveBeenCalledWith([expect.objectContaining({ id: "chg2" })]);
  });

  it("maintains monitors when the last sync is old: health and settings first, then gaps, alerts to the log", async () => {
    vi.mocked(boards.getBoard).mockResolvedValue(board({ monitorsSyncedAt: Date.now() - 31 * 60_000 }) as never);
    vi.mocked(boards.addSources).mockResolvedValue([]);
    vi.mocked(boards.listSources).mockResolvedValue([]);
    vi.mocked(monitors.syncBoardMonitors).mockResolvedValueOnce({ notes: [], alerts: ["Stopped watching gov.example: the page kept failing (HTTP 503)"] });
    const { ctx, steps, emitted } = fakeCtx("poll", { reason: "schedule" });
    await updateGraph(ctx);
    expect(steps).toEqual(["collect", "watch"]);
    expect(monitors.syncBoardMonitors).toHaveBeenCalledWith("b1", plan, "hot");
    expect(monitors.ensureBoardMonitors).toHaveBeenCalledWith("b1", plan, [], { allowPage: true, tier: "hot" });
    expect(boards.markMonitorsSynced).toHaveBeenCalledWith("b1");
    expect(emitted).toContainEqual(expect.objectContaining({ type: "event", event: expect.objectContaining({ kind: "info", message: expect.stringContaining("Stopped watching") }) }));
  });

  it("skips a paused board's manual poll: a paused board does not read the web on request", async () => {
    vi.mocked(boards.getBoard).mockResolvedValue(board({ tier: "paused", monitorsSyncedAt: null }) as never);
    const { ctx, steps } = fakeCtx("poll", { reason: "manual" });
    await updateGraph(ctx);
    expect(steps).toEqual([]);
  });

  it("does not touch monitors on a paused board's webhook poll", async () => {
    vi.mocked(boards.getBoard).mockResolvedValue(board({ tier: "paused", monitorsSyncedAt: null }) as never);
    vi.mocked(boards.addSources).mockResolvedValue([]);
    const { ctx, steps } = fakeCtx("poll", { reason: "webhook" });
    await updateGraph(ctx);
    expect(steps).toEqual(["collect"]);
    expect(monitors.ensureBoardMonitors).not.toHaveBeenCalled();
  });

  it("skips boards that are not live v2 boards", async () => {
    vi.mocked(boards.getBoard).mockResolvedValue(board({ specVersion: 1 }) as never);
    const { ctx, steps } = fakeCtx("poll");
    await updateGraph(ctx);
    expect(steps).toEqual([]);
  });
});

describe("buildGraph", () => {
  it("runs the nodes in order and goes live after saving and watching", async () => {
    const s1 = source("s1", { kind: "web" });
    vi.mocked(boards.getBoard).mockResolvedValue(board({ status: "queued", plan: null, spec: null, data: null, specVersion: 2 }) as never);
    vi.mocked(boards.listMessages).mockResolvedValue([{ role: "user", content: "Valencia floods", ts: 0 }]);
    vi.mocked(searchWeb).mockResolvedValue([{ url: s1.url, title: "x", publisher: null, publishedAt: null, snippet: "s", kind: "web" }]);
    vi.mocked(boards.addSources).mockResolvedValue([s1]);
    vi.mocked(boards.listSources).mockImplementation((async () => [{ ...s1, relevance: vi.mocked(decide).mock.calls.length ? 0.9 : null, sourceType: "news" }]) as never);
    const facts = (await import("../../repo/facts")) as unknown as { listFacts: ReturnType<typeof vi.fn> };
    facts.listFacts.mockResolvedValue([{ id: 1, kind: "metric", key: "deaths", payload: { valueText: "12" }, sourceIds: ["s1"], asOf: null, status: "active" }]);
    const order: string[] = [];
    vi.mocked(boards.saveBoardVersion).mockImplementation((async () => (order.push("save"), 1)) as never);
    vi.mocked(monitors.ensureBoardMonitors).mockImplementation((async () => (order.push("monitors"), "ok")) as never);

    const { ctx, steps, emitted } = fakeCtx("build");
    await buildGraph(ctx);

    expect(steps).toEqual(["plan", "gather[r1]", "triage[r1]", "read[r1]", "extract[r1-read-b0]", "merge[r1]", "coverage", "narrative", "assess", "geocode", "watch"]);
    const statuses = emitted.filter((m) => m.type === "status").map((m) => (m as { status: string }).status);
    expect(statuses).toEqual(["planning", "gathering", "composing", "watching", "live"]);
    expect(order).toEqual(["save", "monitors"]);
    expect(emitted.findIndex((m) => m.type === "partial" && m.stage === "plan")).toBeLessThan(emitted.findIndex((m) => m.type === "spec"));
    expect(boards.setSchedule).toHaveBeenCalledWith("b1", expect.objectContaining({ tier: "hot" }));
    expect(boards.addMessage).toHaveBeenCalledWith("b1", "assistant", expect.stringContaining("Built"));
    expect(boards.savePlan).toHaveBeenCalled();
  });
});
