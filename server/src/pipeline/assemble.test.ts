import { describe, expect, it } from "vitest";
import type { BoardData, Fact, FactKind, PayloadMap, Plan, Source } from "../spec";
import { assemble, diffData, specFromPlan } from "./assemble";

const plan: Plan = {
  title: "Valencia Floods",
  subtitle: "Flash floods in the province of Valencia",
  crisisType: "flood",
  language: "en",
  location: { name: "Valencia, Spain", zoom: 9 },
  lookbackDays: 3,
  entities: ["Valencia", "DANA"],
  newsQueries: ["valencia floods"],
  webQueries: ["valencia flood shelters"],
  monitor: { query: "valencia floods", instructions: "new deaths, closures" },
  metrics: [
    { key: "deaths", label: "Deaths", unit: null, why: "" },
    { key: "evacuated", label: "Evacuated", unit: "people", why: "" },
    { key: "rain-mm", label: "Rainfall", unit: "mm", why: "" },
  ],
  tables: [
    {
      key: "road-closures",
      title: "Road closures",
      columns: [
        { key: "road", label: "Road", kind: "text" },
        { key: "state", label: "State", kind: "status" },
      ],
    },
  ],
  statusGroups: [],
  questions: [{ id: "q1", text: "How many died?" }],
  widgets: [
    { type: "narrative", title: "Situation", span: "full", bind: null, metrics: [] },
    { type: "stat-grid", title: "Key figures", span: "full", bind: null, metrics: ["deaths", "unknown", "evacuated"] },
    { type: "trend", title: "Bad trend", span: "half", bind: "nope", metrics: [] },
    { type: "table", title: "Closures", span: "full", bind: "road-closures", metrics: [] },
    { type: "sources", title: "Sources", span: "full", bind: null, metrics: [] },
    { type: "timeline", title: "Timeline", span: "half", bind: null, metrics: [] },
    { type: "timeline", title: "Duplicate", span: "half", bind: null, metrics: [] },
  ],
};

describe("specFromPlan", () => {
  const spec = specFromPlan(plan);
  it("drops unknown bindings and duplicates, adds required widgets, ends with feed, changelog, sources", () => {
    expect(spec.widgets.map((w) => [w.id, w.type, w.bind])).toEqual([
      ["w1", "narrative", null],
      ["w2", "stat-grid", null],
      ["w3", "map", null],
      ["w4", "table", "road-closures"],
      ["w5", "timeline", null],
      ["w6", "alert-list", null],
      ["w7", "link-list", null],
      ["w8", "feed", null],
      ["w9", "changelog", null],
      ["w10", "sources", null],
    ]);
    expect(spec.widgets[1].metrics).toEqual(["deaths", "evacuated"]);
    expect(spec.widgets[3].title).toBe("Closures");
  });
  it("leaves the map out for a crisis without a place", () => {
    const s = specFromPlan({ ...plan, location: null, widgets: [] });
    expect(s.widgets.some((w) => w.type === "map")).toBe(false);
    expect(s.widgets[0].type).toBe("narrative");
  });
  it("adds widgets for status groups", () => {
    const s = specFromPlan({ ...plan, statusGroups: [{ key: "m365", title: "Microsoft 365" }], widgets: [] });
    expect(s.widgets.find((w) => w.type === "status-grid")).toMatchObject({ bind: "m365", title: "Microsoft 365" });
  });
});

let id = 1;
function f<K extends FactKind>(kind: K, key: string, payload: PayloadMap[K], over: Partial<Fact> = {}): Fact {
  const n = id++;
  return {
    id: n,
    boardId: "b1",
    kind,
    key,
    payload,
    valueNum: kind === "metric" ? ((payload as PayloadMap["metric"]).valueNum ?? null) : null,
    asOf: null,
    sourceIds: ["s1"],
    quote: "q",
    verified: true,
    status: "active",
    supersededBy: null,
    runId: 1,
    createdAt: n,
    ...over,
  } as Fact;
}
const mv = (v: number): PayloadMap["metric"] => ({ valueText: String(v), valueNum: v, unit: null, scope: null });

const sources: Source[] = [
  { id: "s1", url: "https://a.example/1", title: null, publisher: null, kind: "news", publishedAt: null, fetchedAt: 0, snippet: null, relevance: 0.6, sourceType: "news" },
  { id: "s2", url: "https://gva.es/2", title: null, publisher: null, kind: "web", publishedAt: null, fetchedAt: 0, snippet: null, relevance: 0.9, sourceType: "official" },
];

function fixture() {
  id = 1;
  const old1 = f("metric", "deaths", mv(4), { asOf: "2026-10-29T10:00:00Z", status: "superseded" });
  const old2 = f("metric", "deaths", mv(9), { asOf: "2026-10-30T08:00:00Z", status: "superseded" });
  const cur = f("metric", "deaths", mv(12), { asOf: "2026-10-30T14:00:00Z", sourceIds: ["s2"] });
  const conflict = f("metric", "deaths", mv(14), { asOf: "2026-10-30T15:00:00Z", sourceIds: ["s1"] });
  const evac = f("metric", "evacuated", mv(3000), { asOf: "2026-10-30T09:00:00Z" });
  const facts: Fact[] = [
    cur,
    conflict,
    evac,
    f("event", "dam", { title: "Dam breach", detail: "Forata dam", importance: "high" }, { asOf: "2026-10-30T06:00:00Z" }),
    f("event", "army", { title: "Army deployed", detail: "", importance: "medium" }, { asOf: "2026-10-30T12:00:00Z" }),
    f("event", "undated", { title: "Undated", detail: "", importance: "low" }),
    f("place", "paiporta", { name: "Paiporta", placeKind: "impact", note: "worst hit", lat: 39.43, lon: -0.42 }),
    f("place", "nowhere", { name: "Nowhere", placeKind: "impact", note: "" }),
    f("row", "road-closures:cv-35", { table: "road-closures", cells: { road: "CV-35", state: "closed", extra: "x" } }, { asOf: "2026-10-30T10:00:00Z" }),
    f("advisory", "old", { issuer: "AEMET", title: "Yellow", text: "", level: "info", url: null, active: false }),
    f("advisory", "red", { issuer: "AEMET", title: "Red", text: "", level: "warning", url: null, active: true }),
    f("resource", "red-cross", { label: "Red Cross", url: "https://cruzroja.es", resourceKind: "shelter", note: "" }),
    f("resource", "gva", { label: "GVA", url: "https://gva.es", resourceKind: "official", note: "" }),
    f("metric", "rain-mm", mv(300), { asOf: "2026-10-30T10:00:00Z", verified: false }),
  ];
  return { facts, history: [old1, old2, cur, conflict, evac] as Fact<"metric">[] };
}

describe("assemble", () => {
  const spec = specFromPlan(plan);
  const { facts, history } = fixture();
  const out = assemble({
    plan,
    spec,
    facts,
    metricHistory: history,
    sources,
    prev: null,
    overrides: {
      headline: { text: "12 dead", sources: ["s2"] },
      narrative: [{ text: "Floods hit Valencia.", sources: ["s1"] }],
      assessment: { status: "ongoing", statusP: { ongoing: 0.9 }, severity: 4.2, severityP: { "3": 0.8 } },
      location: { name: "Valencia, Spain", lat: 39.47, lon: -0.38, zoom: 9 },
    },
    now: 1_000,
  });
  const byType = (t: string) => out.spec.widgets.find((w) => w.type === t)!;
  const data = (t: string) => out.data.widgets[byType(t).id] as never as Record<string, any>;

  it("picks the newest value, shows the same-window conflict, computes delta and tone", () => {
    const items = data("stat-grid").items;
    expect(items.map((i: { key: string }) => i.key)).toEqual(["deaths", "evacuated"]);
    const d = items[0];
    expect(d).toMatchObject({ valueText: "14", tone: "critical", deltaNum: 5, delta: "+5 since 08:00 UTC", asOf: "2026-10-30T15:00:00Z", sources: ["s1"] });
    expect(d.conflict).toEqual([{ valueText: "12", sources: ["s2"] }]);
    expect(d.history.map((p: { v: number }) => p.v)).toEqual([4, 9, 12, 14]);
    expect(items[1].tone).toBe("warning");
  });

  it("adds a trend widget for a metric with three or more points, after the stat grid", () => {
    const i = out.spec.widgets.findIndex((w) => w.id === "trend-deaths");
    expect(out.spec.widgets[i - 1].type).toBe("stat-grid");
    expect((out.data.widgets["trend-deaths"] as { points: unknown[] }).points).toHaveLength(4);
  });

  it("orders the timeline newest first with undated last", () => {
    expect(data("timeline").items.map((x: { title: string }) => x.title)).toEqual(["Army deployed", "Dam breach", "Undated"]);
  });

  it("maps only geocoded places and centers on the location", () => {
    const m = data("map");
    expect(m.points.map((p: { name: string }) => p.name)).toEqual(["Paiporta"]);
    expect(m.center).toMatchObject({ lat: 39.47 });
  });

  it("fills tables with the plan's columns only", () => {
    const t = data("table");
    expect(t.columns.map((c: { key: string }) => c.key)).toEqual(["road", "state"]);
    expect(t.rows[0].cells).toEqual({ road: "CV-35", state: "closed" });
  });

  it("lists active advisories first and resources by kind", () => {
    expect(data("alert-list").items.map((x: { title: string }) => x.title)).toEqual(["Red", "Yellow"]);
    expect(data("link-list").items.map((x: { label: string }) => x.label)).toEqual(["GVA", "Red Cross"]);
  });

  it("fills the header and narrative from overrides, ignores unverified facts", () => {
    expect(out.data.header).toMatchObject({
      title: "Valencia Floods",
      accent: "blue",
      headline: { text: "12 dead" },
      status: "ongoing",
      severity: 4.2,
      asOf: "2026-10-30T15:00:00Z",
      language: "en",
    });
    expect(data("narrative").sentences).toHaveLength(1);
    expect(out.data.hidden).toEqual([]);
    expect(out.data.generatedAt).toBe(1_000);
  });

  it("keeps header and narrative from prev when there are no overrides, and hides empty widgets", () => {
    const next = assemble({ plan, spec, facts: [], metricHistory: [], sources, prev: out.data, overrides: {}, now: 2_000 });
    expect(next.data.header.headline).toEqual(out.data.header.headline);
    expect(next.data.header.severity).toBe(4.2);
    expect(next.data.header.location).toEqual(out.data.header.location);
    expect(next.data.widgets[byType("narrative").id]).toEqual(data("narrative"));
    const hidden = next.data.hidden.map((wid) => next.spec.widgets.find((w) => w.id === wid)!.type).sort();
    expect(hidden).toEqual(["alert-list", "link-list", "stat-grid", "table", "timeline"]);
  });

  it("is deterministic", () => {
    const { facts: f2, history: h2 } = fixture();
    const again = assemble({ plan, spec, facts: f2, metricHistory: h2, sources, prev: null, overrides: {
      headline: { text: "12 dead", sources: ["s2"] },
      narrative: [{ text: "Floods hit Valencia.", sources: ["s1"] }],
      assessment: { status: "ongoing", statusP: { ongoing: 0.9 }, severity: 4.2, severityP: { "3": 0.8 } },
      location: { name: "Valencia, Spain", lat: 39.47, lon: -0.38, zoom: 9 },
    }, now: 1_000 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(out));
  });
});

describe("diffData", () => {
  const base: BoardData = {
    header: {
      title: "T", subtitle: null, crisisType: "flood", accent: "blue", headline: null, status: null, statusP: null,
      severity: null, severityP: null, location: null, asOf: null, language: "en",
    },
    widgets: { w1: { sentences: [] }, w2: { items: [] } },
    hidden: ["w3"],
    generatedAt: 1,
  };
  it("reports everything without prev", () => {
    expect(diffData(null, base)).toEqual({ widgets: ["w1", "w2"], header: true, hidden: true });
  });
  it("reports only changed widgets", () => {
    const next: BoardData = { ...base, widgets: { ...base.widgets, w2: { items: [{ id: "x" }] } as never }, generatedAt: 2 };
    expect(diffData(base, next)).toEqual({ widgets: ["w2"], header: false, hidden: false });
  });
  it("notices header and hidden changes", () => {
    const next: BoardData = { ...base, header: { ...base.header, severity: 3 }, hidden: [] };
    expect(diffData(base, next)).toEqual({ widgets: [], header: true, hidden: true });
  });
});
