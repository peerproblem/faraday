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
  it("keeps each widget's display from the previous spec, matched by key", () => {
    const prev = { ...spec, widgets: spec.widgets.map((w, i) => (w.type === "timeline" ? { ...w, id: `w${i + 9}`, display: "story" as const } : w)) };
    const s = specFromPlan({ ...plan, widgets: [] }, prev);
    expect(s.widgets.find((w) => w.type === "timeline")?.display).toBe("story");
    expect(s.widgets.filter((w) => w.display)).toHaveLength(1);
    expect(specFromPlan(plan).widgets.some((w) => "display" in w)).toBe(false);
  });

  it("keeps the board template from the previous spec", () => {
    expect(specFromPlan(plan, { ...spec, template: "finance" }).template).toBe("finance");
    expect("template" in specFromPlan(plan, spec)).toBe(false);
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

  it("keeps the board template when it recomposes", () => {
    expect(assemble({ plan, spec: { ...spec, template: "finance" }, facts: [], metricHistory: [], sources, prev: null, overrides: {}, now: 2_000 }).spec.template).toBe("finance");
    expect("template" in out.spec).toBe(false);
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

describe("social promotion boundary", () => {
  const social: Source = { ...sources[0], id: "sx", kind: "social", sourceType: "social" };
  const input = (facts: Fact[], extra: Source[] = []) => ({ plan, spec: specFromPlan(plan), facts,
    metricHistory: facts.filter((x): x is Fact<"metric"> => x.kind === "metric"), sources: [social, ...extra], prev: null, overrides: {}, now: 1 });
  const metric = () => f("metric", "deaths", mv(999), { sourceIds: ["sx"], quote: "There are 999 deaths reported locally.", asOf: "2026-11-14T00:00:00Z" });
  it("quarantines every social-only fact and metric history; only quotes appear in the unverified widget", () => {
    const facts = [metric(),
      f("event", "evacuation", { title: "Evacuate now", detail: "reported", importance: "high" }, { sourceIds: ["sx"], quote: "Evacuate now according to a local post." }),
      f("place", "shelter", { name: "School", lat: 39, lon: -0.3, placeKind: "shelter", note: "" }, { sourceIds: ["sx"], quote: "The school is reportedly a shelter." }),
      f("row", "road-closures:a", { table: "road-closures", cells: { road: "A", state: "closed" } }, { sourceIds: ["sx"], quote: "Road A is reportedly closed today." })];
    const out = assemble(input(facts));
    for (const type of ["stat-grid", "table", "timeline", "map", "trend"]) {
      for (const w of out.spec.widgets.filter((w) => w.type === type)) expect(out.data.hidden).toContain(w.id);
    }
    expect(out.data.header.asOf).toBeNull();
    expect(out.data.widgets["on-the-ground"]).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ quote: facts[0].quote, sources: ["sx"] })]) });
    expect(out.spec.widgets.find((w) => w.type === "on-the-ground")?.title).toBe("On the ground (unverified)");
    const order = out.spec.widgets.map((w) => w.type);
    expect(order.slice(order.indexOf("on-the-ground") + 1)).toEqual(["feed", "changelog", "sources"]);
  });
  it.each(["news", "official"] as const)("permits the same fact when independently cited to %s", (sourceType) => {
    const fact = metric(); fact.sourceIds.push("confirmed");
    const out = assemble(input([fact], [{ ...sources[0], id: "confirmed", sourceType }]));
    const stat = out.spec.widgets.find((w) => w.type === "stat-grid")!;
    expect(out.data.widgets[stat.id]).toMatchObject({ items: [{ valueNum: 999, sources: ["sx", "confirmed"] }] });
    expect(out.spec.widgets.some((w) => w.type === "on-the-ground")).toBe(false);
  });
  it("does not promote via aggregator, unrelated news fact, or an X source mislabeled official", () => {
    const fact = metric(); fact.sourceIds.push("agg");
    const extra = [{ ...sources[0], id: "agg", sourceType: "aggregator" as const }, ...sources];
    const officialMetric = f("metric", "deaths", mv(12), { sourceIds: ["s2"] });
    const out = assemble(input([fact, officialMetric], extra));
    const stat = out.spec.widgets.find((w) => w.type === "stat-grid")!;
    expect(out.data.widgets[stat.id]).toMatchObject({ items: [{ valueNum: 12 }] });
    const mislabeled = assemble({ ...input([metric()]), sources: [{ ...social, sourceType: "official" }] });
    expect(mislabeled.data.hidden).toContain(stat.id);
  });
  it("removes unverified citations from old and new narrative/headline overrides", () => {
    const out = assemble({ ...input([metric()]), overrides: {
      headline: { text: "999 died", sources: ["sx"] }, narrative: [{ text: "999 died", sources: ["sx"] }],
    } });
    expect(out.data.header.headline).toBeNull();
    expect(out.data.hidden).toContain(out.spec.widgets.find((w) => w.type === "narrative")!.id);
  });
});

it("shows a post in another language by its translation, and not at all until it has one", () => {
  const post = { ...sources[0], id: "sx", kind: "social" as const, sourceType: "social" as const, lang: "es" };
  const report: Fact = { id: 90, boardId: "b", kind: "event", key: "march", payload: { title: "March", detail: "", importance: "medium" }, valueNum: null, asOf: null,
    sourceIds: ["sx"], quote: "La marcha llena la Gran Via.", verified: true, status: "active", supersededBy: null, runId: null, createdAt: 1 };
  const run = (f: Fact) => assemble({ plan, spec: specFromPlan(plan), facts: [f], metricHistory: [], sources: [...sources, post], prev: null, overrides: {}, now: 1 });
  const waiting = run(report);
  expect(waiting.data.widgets["on-the-ground"]).toBeUndefined();
  expect(JSON.stringify(waiting.data)).not.toContain("La marcha");
  const translated = run({ ...report, quoteEn: "The march fills Gran Via." });
  expect(translated.data.widgets["on-the-ground"]).toEqual({
    items: [{ id: "social-90", quote: "The march fills Gran Via.", sources: ["sx"], asOf: null, evidence: { source: "sx", quote: "The march fills Gran Via.", original: "La marcha llena la Gran Via." } }],
  });
});

it("represents corroborated social claims using the independent news fact and removes their unverified entry", () => {
  const social = { ...sources[0], id: "sx", kind: "social" as const, sourceType: "social" as const };
  const asOf = "2026-11-14T00:00:00Z";
  const report = f("metric", "deaths", mv(12), { sourceIds: ["sx"], asOf });
  const confirmation = f("metric", "deaths", mv(12), { sourceIds: ["s2"], asOf });
  const out = assemble({ plan, spec: specFromPlan(plan), facts: [report, confirmation], metricHistory: [], sources: [...sources, social], prev: null, overrides: {}, now: 1 });
  const stat = out.spec.widgets.find((w) => w.type === "stat-grid")!;
  expect(out.data.widgets[stat.id]).toMatchObject({ items: [{ valueNum: 12, sources: ["s2"] }] });
  expect(out.spec.widgets.some((w) => w.type === "on-the-ground")).toBe(false);
});


it("carries cyber roles from the plan and facts into delivered widget data", () => {
  const cyber: Plan = { ...plan, crisisType: "cyberattack", location: null, widgets: [],
    metrics: [{ key: "alpha", label: "Affected accounts", unit: "accounts", why: "impact", cyberRole: "impact" }],
    tables: [{ key: "releases", title: "Affected releases", cyberRole: "affected-scope", columns: [{ key: "build", label: "Build", kind: "text", cyberRole: "subject" }] }],
    statusGroups: [{ key: "portal", title: "Portal" }],
  };
  const facts = [
    f("metric", "alpha", mv(10)),
    f("row", "releases:v1", { table: "releases", cells: { build: "v1" } }),
    f("status", "portal:all", { group: "portal", name: "Portal", state: "degraded", note: "", scope: "overall" }),
    f("advisory", "next", { issuer: "Provider", title: "Next steps", text: "Call support", level: "info", url: null, active: true, audience: "users" }),
    f("resource", "check", { label: "Check here", url: "https://example.com/check", resourceKind: "official", note: "", purpose: "verification" }),
  ];
  const output = assemble({ plan: cyber, spec: specFromPlan(cyber), facts, metricHistory: [], sources, prev: null, overrides: {}, now: 0 });
  const data = (type: string) => output.data.widgets[output.spec.widgets.find(widget => widget.type === type)!.id];
  expect(data("stat-grid")).toMatchObject({ items: [{ key: "alpha", cyberRole: "impact" }] });
  expect(data("table")).toMatchObject({ cyberRole: "affected-scope", columns: [{ cyberRole: "subject" }] });
  expect(data("status-grid")).toMatchObject({ items: [{ scope: "overall" }] });
  expect(data("alert-list")).toMatchObject({ items: [{ audience: "users" }] });
  expect(data("link-list")).toMatchObject({ items: [{ purpose: "verification" }] });
});
