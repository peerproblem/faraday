import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Fact, Plan, Source, StagedFact } from "../../spec";

vi.mock("../../llm/decide", () => ({ decide: vi.fn() }));
vi.mock("../../repo/geocode", () => ({ getCachedGeocode: vi.fn(), putCachedGeocode: vi.fn() }));
vi.mock("../../repo/facts", () => ({ updatePlaceCoords: vi.fn() }));
vi.mock("../../repo/boards", () => ({ saveSourceText: vi.fn() }));
vi.mock("../../contextdev", () => ({ scrapeMarkdown: vi.fn(), searchNews: vi.fn(), searchWeb: vi.fn() }));

const { decide } = await import("../../llm/decide");
const { getCachedGeocode, putCachedGeocode } = await import("../../repo/geocode");
const { updatePlaceCoords } = await import("../../repo/facts");
const { saveSourceText } = await import("../../repo/boards");
const { scrapeMarkdown, searchNews, searchWeb } = await import("../../contextdev");
const { toExtracted, pickExtractSources, batches } = await import("./extract");
const { rotateQueries, gather, dedupeDocs } = await import("./gather");
const { templateNote } = await import("./note");
const { toHints, needsHints } = await import("./hints");
const { citeSources } = await import("./narrative");
const { normalizePlan, applyPlanPatch } = await import("./plan");
const { triage, untriaged } = await import("./triage");
const { assess, materiality } = await import("./assess");
const { geocode, geocodeBoard } = await import("./geocode");
const { pickReadTargets, readSources } = await import("./read");
const { slugify, programOf, pool } = await import("./util");

const use = { llm: vi.fn(), context: vi.fn() };
const signal = new AbortController().signal;

const plan: Plan = {
  title: "Valencia Floods",
  subtitle: null,
  crisisType: "flood",
  language: "en",
  location: { name: "Valencia, Spain", zoom: 9 },
  lookbackDays: 7,
  entities: ["Valencia", "DANA"],
  newsQueries: ["a", "b", "c", "d", "e"],
  webQueries: ["w1"],
  monitor: { query: "Valencia floods", instructions: "New figures" },
  metrics: [{ key: "deaths", label: "Deaths", unit: null, why: "x" }],
  tables: [{ key: "road-closures", title: "Road closures", columns: [{ key: "road", label: "Road", kind: "text" }, { key: "status", label: "Status", kind: "status" }] }],
  statusGroups: [{ key: "transit", title: "Transit" }],
  questions: [{ id: "q1", text: "How many died?" }],
  widgets: [],
};

const src = (id: string, over: Partial<Source> = {}): Source => ({
  id,
  url: `https://example.com/${id}`,
  title: `t ${id}`,
  publisher: "example.com",
  kind: "news",
  publishedAt: null,
  fetchedAt: 0,
  snippet: "snippet",
  relevance: 0.9,
  sourceType: "news",
  ...over,
});

const raw = (over: Record<string, unknown>) =>
  ({
    kind: "metric",
    key: "deaths",
    sourceId: "s1",
    quote: "At least 12 people died.",
    asOf: null,
    valueText: null,
    valueNum: null,
    unit: null,
    scope: null,
    title: null,
    detail: null,
    importance: null,
    name: null,
    placeKind: null,
    note: null,
    issuer: null,
    text: null,
    level: null,
    url: null,
    active: null,
    label: null,
    resourceKind: null,
    table: null,
    cells: null,
    group: null,
    state: null,
    ...over,
  }) as Parameters<typeof toExtracted>[0];

beforeEach(() => vi.clearAllMocks());

describe("toExtracted", () => {
  it("keeps known metric keys and prefixes unknown ones with new:", () => {
    expect(toExtracted(raw({ valueText: "12", valueNum: 12 }), plan)).toMatchObject({ kind: "metric", key: "deaths", payload: { valueText: "12", valueNum: 12 } });
    expect(toExtracted(raw({ key: "Missing People", valueText: "40" }), plan)?.key).toBe("new:missing-people");
    expect(toExtracted(raw({ key: "new:Missing", valueText: "40" }), plan)?.key).toBe("new:missing");
  });
  it("drops facts without a quote or value", () => {
    expect(toExtracted(raw({ quote: " " , valueText: "1"}), plan)).toBeNull();
    expect(toExtracted(raw({ valueText: null }), plan)).toBeNull();
  });
  it("computes row keys from the table's first column and maps cells by key or label", () => {
    const f = toExtracted(raw({ kind: "row", key: "x", table: "road-closures", cells: [{ column: "Road", value: "CV-35" }, { column: "status", value: "closed" }, { column: "bogus", value: "y" }] }), plan);
    expect(f).toMatchObject({ key: "road-closures:cv-35", payload: { table: "road-closures", cells: { road: "CV-35", status: "closed" } } });
    expect(toExtracted(raw({ kind: "row", table: "unknown", cells: [{ column: "road", value: "a" }] }), plan)).toBeNull();
  });
  it("computes status keys from group and name", () => {
    expect(toExtracted(raw({ kind: "status", group: "transit", name: "Metro Line 1", state: "down" }), plan)).toMatchObject({ key: "transit:metro-line-1", payload: { state: "down" } });
  });
  it("defaults advisory fields and keeps active unless lifted", () => {
    expect(toExtracted(raw({ kind: "advisory", title: "Red alert", active: false }), plan)).toMatchObject({ key: "red-alert", payload: { level: "info", active: false, url: null } });
  });
});

describe("pickExtractSources", () => {
  it("reserves a share for official and web sources and caps the total", () => {
    const sources = [
      ...Array.from({ length: 10 }, (_, i) => src(`s${i + 1}`, { relevance: 0.95 })),
      src("s20", { kind: "web", relevance: 0.5 }),
      src("s21", { sourceType: "official", relevance: 0.45 }),
      src("s22", { relevance: 0 }),
    ];
    const picked = pickExtractSources(sources, 5);
    expect(picked).toHaveLength(5);
    expect(picked.map((s) => s.id).slice(0, 2).sort()).toEqual(["s20", "s21"]);
    expect(picked.some((s) => s.id === "s22")).toBe(false);
  });
  it("batches by LIMITS.extractBatch (4)", () => {
    expect(batches([1, 2, 3, 4, 5, 6, 7]).map((b) => b.length)).toEqual([4, 3]);
  });
});

describe("queries", () => {
  it("rotates through all news queries three at a time", () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < 4; slot++) for (const q of rotateQueries(plan.newsQueries, slot * 120_000)) seen.add(q);
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(rotateQueries(["x", "y"], 0)).toEqual(["x", "y"]);
    expect(rotateQueries(plan.newsQueries, 120_000)).toHaveLength(3);
  });
  it("gathers in parallel, records calls and reports failures without throwing", async () => {
    vi.mocked(searchNews).mockResolvedValueOnce([{ url: "https://a.com/x#frag", title: "x", publisher: null, publishedAt: null, snippet: null, kind: "news" }]);
    vi.mocked(searchNews).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(searchWeb).mockResolvedValue([{ url: "https://a.com/x", title: "x", publisher: null, publishedAt: null, snippet: null, kind: "web" }]);
    const r = await gather({ newsQueries: ["n1", "n2"], webQueries: ["w"], lookbackDays: 3 }, use, signal);
    expect(r.calls).toBe(3);
    expect(r.docs).toHaveLength(1);
    expect(r.failures[0]).toContain("boom");
    expect(use.context).toHaveBeenCalledWith(3);
    expect(vi.mocked(searchWeb).mock.calls[0][1]).toBe("last_week");
  });
  it("dedupes by url without fragment", () => {
    expect(dedupeDocs([{ url: "https://a/x#1" }, { url: "https://a/x" }] as never)).toHaveLength(1);
  });
});

describe("notes and hints", () => {
  it("uses a template for a single metric change", () => {
    expect(templateNote(plan, { added: [], changed: [{ kind: "metric", key: "deaths", from: "12", to: "15" }], superseded: 1 })).toBe("Deaths: 12 to 15");
    expect(templateNote(plan, { added: [{ kind: "event", key: "x" }], changed: [], superseded: 0 })).toBeNull();
  });
  it("turns model hints into merge hints, ignoring unknown targets", () => {
    const incoming = [
      { kind: "metric", key: "new:dead" },
      { kind: "event", key: "e1" },
      { kind: "event", key: "e2" },
    ] as StagedFact[];
    const current = [{ id: 7, kind: "event" }] as Fact[];
    const h = toHints(
      {
        keyAliases: [{ from: "new:dead", to: "deaths" }, { from: "new:x", to: "unknown" }],
        sameEvents: [{ incoming: 1, existingId: 7, duplicateOf: null }, { incoming: 2, existingId: null, duplicateOf: 1 }, { incoming: 0, existingId: 7, duplicateOf: null }],
      },
      plan,
      incoming,
      current,
    );
    expect(h).toEqual({ keyAliases: { "metric:new:dead": "deaths" }, eventSameAs: { 1: 7, 2: -2 } });
    expect(needsHints([], [{ kind: "metric", key: "deaths" }] as StagedFact[])).toBe(false);
    expect(needsHints([], incoming)).toBe(true);
  });
  it("converts cited fact ids to source ids", () => {
    const facts = new Map([[3, { sourceIds: ["s1", "s2"] } as Fact], [4, { sourceIds: ["s2"] } as Fact]]);
    expect(citeSources(["f3", "f4", "f99"], facts).sort()).toEqual(["s1", "s2"]);
  });
});

describe("plan", () => {
  it("normalises keys, dedupes and caps", () => {
    const p = normalizePlan({ ...plan, metrics: [{ key: "Deaths", label: "D", unit: null, why: "" }, { key: "deaths", label: "D2", unit: null, why: "" }], language: "" });
    expect(p.metrics).toHaveLength(1);
    expect(p.metrics[0].key).toBe("deaths");
    expect(p.language).toBe("en");
  });
  it("applies a patch and reports new keys, keeping feed/changelog/sources last", () => {
    const base = { ...plan, widgets: [{ type: "narrative", title: "S", span: "full", bind: null, metrics: [] }, { type: "sources", title: "Src", span: "full", bind: null, metrics: [] }] } as Plan;
    const { plan: next, newKeys } = applyPlanPatch(base, {
      reply: "ok",
      addMetrics: [{ key: "missing", label: "Missing", unit: null, why: "" }],
      removeMetricKeys: [],
      addTables: [],
      removeTableKeys: ["road-closures"],
      addStatusGroups: [],
      addWidgets: [{ type: "trend", title: "Missing over time", span: "half", bind: "missing", metrics: [] }],
      removeWidgetTitles: [],
      newsQueries: ["n-new"],
      webQueries: [],
      addQuestions: ["Where?"],
    });
    expect(newKeys.metrics).toEqual(["missing"]);
    expect(next.tables).toHaveLength(0);
    expect(next.widgets.map((w) => w.type)).toEqual(["narrative", "trend", "sources"]);
    expect(next.newsQueries).toContain("n-new");
    expect(next.questions.at(-1)).toEqual({ id: "q2", text: "Where?" });
  });
  it("builds the program from messages", () => {
    expect(programOf([{ role: "user", content: "a" }, { role: "assistant", content: "x" }, { role: "user", content: "b" }])).toContain("- b");
  });
});

describe("triage", () => {
  it("keeps on-topic sources, maps the publisher type and records decision usage", async () => {
    vi.mocked(decide)
      .mockResolvedValueOnce({ answers: { onTopic: { type: "boolean", probability: 0.9 }, type: { type: "choice", choice: "official", probabilities: {} }, hasFacts: { type: "boolean", probability: 0.8 } }, backend: "google", model: "gemini-decision-1", ms: 1, tokensIn: 100 } as never)
      .mockResolvedValueOnce({ answers: { onTopic: { type: "boolean", probability: 0.1 }, type: { type: "choice", choice: "weird", probabilities: {} }, hasFacts: { type: "boolean", probability: 0.1 } }, backend: "google", model: "gemini-decision-1", ms: 1, tokensIn: 100 } as never);
    const r = await triage(plan, [src("s1"), src("s2")], use, signal);
    expect(r.kept).toEqual(["s1"]);
    expect(r.dropped).toEqual(["s2"]);
    expect(r.rows[1].sourceType).toBe("other");
    expect(use.llm).toHaveBeenCalledWith("gemini-decision-1", { inputTokens: 100, outputTokens: 0 });
  });
  it("skips sources that fail alone, throws when all fail", async () => {
    vi.mocked(decide).mockRejectedValue(new Error("x"));
    await expect(triage(plan, [src("s1")], use, signal)).rejects.toThrow(/all 1/);
  });
  it("lists only untriaged sources, newest first", () => {
    const list = untriaged([src("s1", { relevance: 0.5 }), src("s2", { relevance: null, publishedAt: "2026-01-01" }), src("s3", { relevance: null, publishedAt: "2026-02-01" })]);
    expect(list.map((s) => s.id)).toEqual(["s3", "s2"]);
  });
});

describe("assess", () => {
  it("maps the 0-based score to severity 1..5 and keys the distribution 1..5", async () => {
    vi.mocked(decide).mockResolvedValueOnce({
      answers: { severity: { type: "score", score: 3.2, probabilities: { "0": 0, "3": 0.8, "4": 0.2 } }, status: { type: "choice", choice: "ongoing", probabilities: { ongoing: 0.9 } } },
      backend: "google",
      model: "m",
      ms: 1,
      tokensIn: 5,
    } as never);
    const a = await assess(plan, [], use, signal);
    expect(a.severity).toBeCloseTo(4.2);
    expect(a.severityP).toEqual({ "1": 0, "4": 0.8, "5": 0.2 });
    expect(a.status).toBe("ongoing");
  });
  it("materiality uses the threshold and buckets importance", async () => {
    vi.mocked(decide).mockResolvedValueOnce({ answers: { material: { type: "boolean", probability: 0.7 }, importance: { type: "score", score: 1.8, probabilities: {} } }, backend: "google", model: "m", ms: 1, tokensIn: 5 } as never);
    expect(await materiality(null, { added: [], changed: [], superseded: 0 }, [], use, signal)).toMatchObject({ material: true, importance: "high" });
  });
});

describe("geocode", () => {
  it("uses the cache, calls Nominatim with a generic user agent and stores misses", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValueOnce({ lat: 1, lon: 2, displayName: "x" });
    expect(await geocode("Valencia")).toEqual({ lat: 1, lon: 2, displayName: "x" });
    vi.mocked(getCachedGeocode).mockResolvedValueOnce(undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    expect(await geocode("Nowhere", undefined, fetchImpl as never)).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("faraday-board-builder/1.0 (+https://faraday.watch)");
    expect(putCachedGeocode).toHaveBeenCalledWith("nowhere", null);
  });
  it("geocodes the location and places, writing coordinates", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValue({ lat: 39.4, lon: -0.37, displayName: "Valencia" });
    const place = { id: 5, kind: "place", status: "active", payload: { name: "Paiporta", placeKind: "impact", note: "" } } as unknown as Fact;
    const r = await geocodeBoard(plan, [place], signal);
    expect(r.location).toEqual({ name: "Valencia, Spain", lat: 39.4, lon: -0.37, zoom: 9 });
    expect(r.placed).toBe(1);
    expect(updatePlaceCoords).toHaveBeenCalledWith(5, 39.4, -0.37);
    expect(vi.mocked(getCachedGeocode).mock.calls[1][0]).toBe("paiporta, valencia, spain");
  });
});

describe("read", () => {
  it("prefers official and web sources and stores only real pages", async () => {
    const targets = pickReadTargets([src("s1"), src("s2", { kind: "web", relevance: 0.5 }), src("s3", { sourceType: "official", relevance: 0.4 })], 5);
    expect(targets.map((s) => s.id)).toEqual(["s3", "s2"]);
    vi.mocked(scrapeMarkdown).mockResolvedValueOnce("x".repeat(500)).mockResolvedValueOnce("short");
    const read = await readSources("b1", targets, use, signal);
    expect(read).toEqual(["s3"]);
    expect(saveSourceText).toHaveBeenCalledTimes(1);
  });
});

describe("util", () => {
  it("slugifies with accents and non-latin text", () => {
    expect(slugify("Carretera CV-35 (Llíria)")).toBe("carretera-cv-35-lliria");
    expect(slugify("서울 지하철 2호선")).toBe("서울-지하철-2호선");
    expect(slugify("!!!")).toBe("item");
  });
  it("pool keeps order and respects the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await pool([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
