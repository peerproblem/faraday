import { describe, expect, it } from "vitest";
import type { Fact, FactKind, PayloadMap, StagedFact } from "../spec";
import { mergeFacts, type MergeHints } from "./merge";

const NO_HINTS: MergeHints = { keyAliases: {}, eventSameAs: {} };

let nextId = 100;
function fact<K extends FactKind>(kind: K, key: string, payload: PayloadMap[K], over: Partial<Fact<K>> = {}): Fact {
  const id = nextId++;
  return {
    id,
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
    createdAt: id,
    ...over,
  } as Fact;
}
function staged<K extends FactKind>(kind: K, key: string, payload: PayloadMap[K], over: Partial<StagedFact> = {}): StagedFact {
  return {
    kind,
    key,
    sourceId: "s2",
    quote: "a quote here",
    asOf: null,
    payload,
    sourceType: "news",
    relevance: 0.8,
    valueNum: kind === "metric" ? ((payload as PayloadMap["metric"]).valueNum ?? null) : null,
    ...over,
  } as StagedFact;
}
const m = (v: number, text = String(v)): PayloadMap["metric"] => ({ valueText: text, valueNum: v, unit: null, scope: null });

describe("mergeFacts: metrics", () => {
  it("adds a new key", () => {
    const r = mergeFacts([], [staged("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" })], NO_HINTS);
    expect(r.insert).toHaveLength(1);
    expect(r.insert[0]).toMatchObject({ key: "deaths", valueNum: 12, sourceIds: ["s2"], status: "active" });
    expect(r.diff.added).toEqual([{ kind: "metric", key: "deaths" }]);
    expect(r.supersede).toEqual([]);
  });

  it("confirms the same value from another source instead of inserting", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(12, "twelve"), { asOf: "2026-10-30T12:00:00Z" })], NO_HINTS);
    expect(r.insert).toEqual([]);
    expect(r.addSources).toEqual([{ id: cur.id, sourceIds: ["s2"], asOf: "2026-10-30T12:00:00Z" }]);
    expect(r.diff).toEqual({ added: [], changed: [], superseded: 0 });
  });

  it("does not add a source twice", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z", sourceIds: ["s2"] });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(12), { asOf: "2026-10-30T09:00:00Z" })], NO_HINTS);
    expect(r.addSources).toEqual([]);
  });

  it("replaces the value on a later day and supersedes the old one", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(15), { asOf: "2026-10-31T08:00:00Z" })], NO_HINTS);
    expect(r.insert[0]).toMatchObject({ valueNum: 15, status: "active" });
    expect(r.supersede).toEqual([{ id: cur.id, by: 0 }]);
    expect(r.diff.changed).toEqual([{ kind: "metric", key: "deaths", from: "12", to: "15" }]);
    expect(r.diff.superseded).toBe(1);
  });

  it("replaces the value later the same day when hours apart", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T06:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(15), { asOf: "2026-10-30T18:00:00Z" })], NO_HINTS);
    expect(r.supersede).toEqual([{ id: cur.id, by: 0 }]);
  });

  it("keeps a same-window disagreement from another source as a conflict", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(14), { asOf: "2026-10-30T11:00:00Z" })], NO_HINTS);
    expect(r.insert[0]).toMatchObject({ valueNum: 14, status: "active" });
    expect(r.supersede).toEqual([]);
    expect(r.diff.changed).toEqual([{ kind: "metric", key: "deaths", from: "12", to: "14" }]);
  });

  it("treats a later report from the same source as an update, not a conflict", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z", sourceIds: ["s2"] });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(14), { asOf: "2026-10-30T11:00:00Z" })], NO_HINTS);
    expect(r.supersede).toEqual([{ id: cur.id, by: 0 }]);
  });

  it("stores an older value as superseded history", () => {
    const cur = fact("metric", "deaths", m(15), { asOf: "2026-10-31T10:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(9), { asOf: "2026-10-29T10:00:00Z" })], NO_HINTS);
    expect(r.insert[0]).toMatchObject({ valueNum: 9, status: "superseded", supersededBy: { id: cur.id } });
    expect(r.supersede).toEqual([]);
    expect(r.diff).toEqual({ added: [], changed: [], superseded: 0 });
  });

  it("keeps an undated different value without changing what is shown", () => {
    const cur = fact("metric", "deaths", m(15), { asOf: "2026-10-31T10:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(9))], NO_HINTS);
    expect(r.insert[0]).toMatchObject({ status: "active" });
    expect(r.diff.changed).toEqual([]);
  });

  it("resolves key aliases and strips new:", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts(
      [cur],
      [
        staged("metric", "new:dead", m(12), { asOf: "2026-10-30T10:00:00Z" }),
        staged("metric", "new:roads-closed", m(40), { asOf: "2026-10-30T10:00:00Z" }),
      ],
      { keyAliases: { "metric:new:dead": "deaths" }, eventSameAs: {} },
    );
    expect(r.addSources).toEqual([{ id: cur.id, sourceIds: ["s2"] }]);
    expect(r.insert.map((x) => x.key)).toEqual(["roads-closed"]);
  });

  it("chains several updates in one batch", () => {
    const r = mergeFacts(
      [],
      [
        staged("metric", "deaths", m(10), { asOf: "2026-10-29T10:00:00Z" }),
        staged("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" }),
        staged("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z", sourceId: "s3" }),
      ],
      NO_HINTS,
    );
    expect(r.insert).toHaveLength(2);
    expect(r.insert[0]).toMatchObject({ valueNum: 10, status: "superseded", supersededBy: { index: 1 } });
    expect(r.insert[1]).toMatchObject({ valueNum: 12, status: "active", sourceIds: ["s2", "s3"] });
    expect(r.diff.added).toEqual([{ kind: "metric", key: "deaths" }]);
    expect(r.diff.changed).toEqual([]);
  });

  it("is deterministic", () => {
    const cur = [fact("metric", "deaths", m(12), { asOf: "2026-10-30T10:00:00Z" })];
    const inc = [staged("metric", "deaths", m(15), { asOf: "2026-10-31T08:00:00Z" }), staged("metric", "evacuated", m(3000))];
    expect(mergeFacts(cur, inc, NO_HINTS)).toEqual(mergeFacts(cur, inc, NO_HINTS));
  });
});

describe("mergeFacts: replace-by-key kinds", () => {
  const adv = (title: string, active = true): PayloadMap["advisory"] => ({ issuer: "AEMET", title, text: "", level: "warning", url: null, active });

  it("replaces an advisory with a new report and records the change", () => {
    const cur = fact("advisory", "red-alert", adv("Red alert"), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts([cur], [staged("advisory", "red-alert", adv("Red alert", false), { asOf: "2026-10-31T10:00:00Z" })], NO_HINTS);
    expect(r.supersede).toEqual([{ id: cur.id, by: 0 }]);
    expect(r.diff.changed[0]).toMatchObject({ from: "Red alert", to: "Red alert (lifted)" });
  });

  it("keeps an older advisory report as history only", () => {
    const cur = fact("advisory", "red-alert", adv("Red alert"), { asOf: "2026-10-31T10:00:00Z" });
    const r = mergeFacts([cur], [staged("advisory", "red-alert", adv("Orange alert"), { asOf: "2026-10-30T10:00:00Z" })], NO_HINTS);
    expect(r.insert[0].status).toBe("superseded");
    expect(r.supersede).toEqual([]);
  });

  it("replaces a status and a row by key, confirms identical ones", () => {
    const st = fact("status", "m365:outlook", { group: "m365", name: "Outlook", state: "down", note: "" });
    const row = fact("row", "road-closures:cv-35", { table: "road-closures", cells: { road: "CV-35", state: "closed" } });
    const r = mergeFacts(
      [st, row],
      [
        staged("status", "m365:outlook", { group: "m365", name: "Outlook", state: "operational", note: "restored" }),
        staged("row", "road-closures:cv-35", { table: "road-closures", cells: { road: "cv-35", state: "Closed" } }),
      ],
      NO_HINTS,
    );
    expect(r.supersede).toEqual([{ id: st.id, by: 0 }]);
    expect(r.insert).toHaveLength(1);
    expect(r.addSources).toEqual([{ id: row.id, sourceIds: ["s2"] }]);
    expect(r.diff.changed).toEqual([{ kind: "status", key: "m365:outlook", from: "Outlook: down", to: "Outlook: operational" }]);
  });

  it("carries geocoded coordinates over to a replacing place", () => {
    const cur = fact("place", "paiporta", { name: "Paiporta", placeKind: "impact", note: "", lat: 39.43, lon: -0.42 });
    const r = mergeFacts([cur], [staged("place", "paiporta", { name: "Paiporta", placeKind: "shelter", note: "shelter open" })], NO_HINTS);
    expect(r.insert[0].payload).toMatchObject({ lat: 39.43, lon: -0.42, placeKind: "shelter" });
  });
});

describe("mergeFacts: events", () => {
  const ev = (title: string): PayloadMap["event"] => ({ title, detail: "", importance: "high" });

  it("never supersedes events and adds distinct ones", () => {
    const cur = fact("event", "dam-breach", ev("Dam breach"), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts([cur], [staged("event", "bridge-collapse", ev("Bridge collapse"), { asOf: "2026-10-30T12:00:00Z" })], NO_HINTS);
    expect(r.insert).toHaveLength(1);
    expect(r.supersede).toEqual([]);
    expect(r.diff.added).toEqual([{ kind: "event", key: "bridge-collapse" }]);
  });

  it("uses eventSameAs hints for existing and earlier incoming events", () => {
    const cur = fact("event", "dam-breach", ev("Dam breach"), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts(
      [cur],
      [
        staged("event", "reservoir-wall-fails", ev("Reservoir wall fails"), { asOf: "2026-10-30T10:30:00Z" }),
        staged("event", "army-deployed", ev("Army deployed")),
        staged("event", "troops-sent", ev("Troops sent"), { sourceId: "s4" }),
      ],
      { keyAliases: {}, eventSameAs: { 0: cur.id, 2: -2 } },
    );
    expect(r.addSources).toEqual([{ id: cur.id, sourceIds: ["s2"] }]);
    expect(r.insert).toHaveLength(1);
    expect(r.insert[0].sourceIds).toEqual(["s2", "s4"]);
  });

  it("falls back to normalised title and same day", () => {
    const cur = fact("event", "dam-breach", ev("Dam breach!"), { asOf: "2026-10-30T10:00:00Z" });
    const r = mergeFacts(
      [cur],
      [
        staged("event", "dam-breach-2", ev("dam breach"), { asOf: "2026-10-30T22:00:00Z" }),
        staged("event", "dam-breach-3", ev("Dam breach"), { asOf: "2026-11-02T22:00:00Z" }),
      ],
      NO_HINTS,
    );
    expect(r.addSources).toHaveLength(1);
    expect(r.insert).toHaveLength(1);
  });
});

describe("social trust isolation", () => {
  const opts = { sourceTypes: new Map([["s1", "news" as const], ["sx", "social" as const]]) };
  it("a newer social metric cannot supersede or advance an official/news figure", () => {
    const cur = fact("metric", "deaths", m(12), { asOf: "2026-11-13T00:00:00Z" });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(999), { sourceId: "sx", sourceType: "social", asOf: "2026-11-14T00:00:00Z" })], NO_HINTS, opts);
    expect(r.supersede).toEqual([]);
    expect(r.addSources).toEqual([]);
    expect(r.insert[0].sourceIds).toEqual(["sx"]);
  });
  it("news confirmation creates an independent fact without inheriting social payload fields", () => {
    const cur = fact("metric", "deaths", { ...m(12), scope: "unverified scope" }, { sourceIds: ["sx"] });
    const r = mergeFacts([cur], [staged("metric", "deaths", m(12))], NO_HINTS, opts);
    expect(r.addSources).toEqual([]);
    expect(r.insert[0].payload).toEqual(m(12));
  });
  it("model event duplicate hints cannot attach a trusted citation to social details", () => {
    const cur = fact("event", "fire", { title: "Fire", detail: "unconfirmed details", importance: "high" }, { sourceIds: ["sx"] });
    const r = mergeFacts([cur], [staged("event", "fire", { title: "Fire", detail: "confirmed details", importance: "low" })], { ...NO_HINTS, eventSameAs: { 0: cur.id } }, opts);
    expect(r.addSources).toEqual([]);
    expect(r.insert[0].payload).toMatchObject({ detail: "confirmed details" });
  });
});

it("does not put unverified social numbers into authoritative change-log diffs", () => {
  const cur = fact("metric", "deaths", m(12), { sourceIds: ["sx"], asOf: "2026-11-13T00:00:00Z" });
  const r = mergeFacts([cur], [staged("metric", "deaths", m(999), { sourceId: "sy", sourceType: "social", asOf: "2026-11-14T00:00:00Z" })], NO_HINTS,
    { sourceTypes: new Map([["sx", "social"]]) });
  expect(r.diff).toEqual({ added: [], changed: [], superseded: 0 });
  expect(r.insert[0].valueNum).toBe(999);
});
