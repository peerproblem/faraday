import { describe, expect, it } from "vitest";
import type { BoardData, BoardSpecV2 } from "@/lib/spec";
import { formatSpan, incidentClock, wildfireView } from "./wildfire-data";

const widget = (id: string, type: string, bind: string | null = null) =>
  ({ id, type, title: id, span: "half", bind, metrics: [] }) as BoardSpecV2["widgets"][number];

const spec: BoardSpecV2 = {
  version: 2,
  widgets: [
    widget("stats", "stat-grid"),
    widget("containment", "trend", "official-containment"),
    widget("growth", "trend", "first-day-fire-growth"),
    widget("zones", "table", "evacuation-history"),
    widget("impact", "table", "community-impact"),
    widget("log", "timeline"),
    widget("alerts", "alert-list"),
  ],
};

const stat = (key: string, valueText: string, valueNum: number) =>
  ({ key, label: key, valueText, valueNum, unit: null, delta: null, deltaNum: null, tone: "info", conflict: null, history: [], sources: ["s1"], asOf: null });
const event = (id: string, at: string | null, title: string, importance = "medium") =>
  ({ id, at, title, detail: "", importance, sources: ["s1"], asOf: at });

const data = {
  header: null,
  hidden: [],
  widgets: {
    stats: { items: [stat("final-containment", "100%", 100), stat("official-burned-area", "570", 570), stat("people-evacuated", "16,000", 16000), stat("county-homes-destroyed", "5", 5)] },
    containment: { metric: "official-containment", label: "Containment", unit: "%", points: [
      { t: "2026-10-18T01:21:00.000Z", v: 25, sources: ["s1"] },
      { t: "2026-10-17T05:35:00.000Z", v: 0, sources: ["s1"] },
      { t: "2026-10-23T00:30:00.000Z", v: 100, sources: ["s1"] },
    ] },
    growth: { metric: "first-day-fire-growth", label: "Fire Growth", unit: "acres", points: [
      { t: "2026-10-16T19:09:00.000Z", v: 10, sources: ["s1"] },
      { t: "2026-10-17T02:27:00.000Z", v: 570, sources: ["s1"] },
    ] },
    zones: {
      columns: [{ key: "zone", label: "Zone", kind: "text" }, { key: "lifted", label: "Order Lifted", kind: "text" }],
      rows: [
        { id: "r1", cells: { zone: "SJC05", lifted: "Oct 17, 6:00 PM PDT" }, sources: ["s1"], asOf: "2026-10-17T18:00:00-07:00" },
        { id: "r2", cells: { zone: "SCL13", lifted: "Oct 17, 12:18 PM PDT" }, sources: ["s1"], asOf: "2026-10-17T12:18:00-07:00" },
        { id: "r3", cells: { zone: "SCL12", lifted: "Oct 17, 6:00 PM PDT" }, sources: ["s2"], asOf: "2026-10-17T18:00:00-07:00" },
      ],
    },
    impact: {
      columns: [{ key: "measure", label: "Measure", kind: "text" }, { key: "assessment", label: "Assessment", kind: "text" }],
      rows: [
        { id: "i1", cells: { measure: "Recovery planning", assessment: "Debris-flow risk." }, sources: ["s1"], asOf: "2026-10-27" },
        { id: "i2", cells: { measure: "Homes threatened", assessment: "About 4,000 at peak" }, sources: ["s1"], asOf: "2026-10-27" },
      ],
    },
    log: { items: [
      event("contained", "2026-10-22T17:30:00-07:00", "100% containment reported", "high"),
      event("county", "2026-10-20", "Orange County proclaimed a local emergency"),
      event("restored", "2026-10-19T00:00:00.000Z", "Power restored"),
      event("issued", "2026-10-16T12:54:00-07:00", "Evacuation orders issued", "high"),
      event("ignition", "2026-10-16T18:30:00.000Z", "Norte Fire broke out", "high"),
      event("outage", "2026-10-16T11:31:00", "Power outage"),
      event("grant", null, "FEMA grant secured"),
    ] },
    alerts: { items: [
      { id: "a1", issuer: "CAL FIRE", title: "Burn Scar Area Closed", text: "Closed.", level: "warning", url: null, active: true, sources: ["s1"], asOf: "2026-10-19T16:34:00-07:00" },
      { id: "a2", issuer: "OCFA", title: "Evacuation Orders", text: "In effect.", level: "warning", url: null, active: true, sources: ["s1"], asOf: "2026-10-17T09:47:00-07:00" },
    ] },
  },
} as unknown as BoardData;

describe("incidentClock", () => {
  const clock = incidentClock("America/Los_Angeles");

  it("reads a bare date and a midnight UTC placeholder as that local day", () => {
    expect(clock.parse("2026-10-20")).toMatchObject({ dateOnly: true });
    const placeholder = clock.parse("2026-10-19T00:00:00.000Z")!;
    expect(placeholder.dateOnly).toBe(true);
    expect(clock.dayKey(placeholder.ms)).toBe("2026-10-19");
  });

  it("reads a time without a zone as local wall time", () => {
    const local = clock.parse("2026-10-16T11:31:00")!;
    expect(local.ms).toBe(Date.parse("2026-10-16T11:31:00-07:00"));
    expect(clock.time(local.ms)).toBe("11:31 AM");
    expect(clock.zone(local.ms)).toBe("PDT");
  });
});

describe("wildfireView", () => {
  const view = wildfireView(spec, data, "America/Los_Angeles");

  it("starts the incident at ignition and orders the series by time", () => {
    expect(view.ignition).toBe(Date.parse("2026-10-16T18:30:00.000Z"));
    expect(view.containment.map((p) => p.v)).toEqual([0, 25, 100]);
    expect(view.figures.evacuated?.valueText).toBe("16,000");
    expect(view.homesThreatened?.text).toBe("About 4,000 at peak");
  });

  it("groups zones that were released together", () => {
    expect(view.releases.map((r) => r.zones)).toEqual([["SCL13"], ["SCL12", "SJC05"]]);
    expect(view.releases[1].sources).toEqual(["s1", "s2"]);
  });

  it("logs events on the local day they happened, oldest first", () => {
    expect(view.log.map((group) => [group.key, group.day, group.entries.map((e) => e.id)])).toEqual([
      ["2026-10-16", 1, ["ignition", "outage", "issued"]],
      ["2026-10-19", 4, ["restored"]],
      ["2026-10-20", 5, ["county"]],
      ["2026-10-22", 7, ["contained"]],
      ["undated", null, ["grant"]],
    ]);
    expect(view.log[0].containment).toBe(0);
    expect(view.log[3].containment).toBe(100);
  });

  it("marks each day by what was in force", () => {
    expect(view.days.map((d) => d.state)).toEqual(["orders", "orders", "burning", "burning", "burning", "burning", "contained"]);
  });

  it("keeps only notices that outlasted the evacuation orders", () => {
    expect(view.restrictions.map((n) => n.id)).toEqual(["a1"]);
    expect(view.recovery.map((n) => n.id)).toEqual(["i1", "county", "grant"]);
  });

  it("returns an empty view for a board without data", () => {
    const empty = wildfireView(null, null, "America/Los_Angeles");
    expect(empty.ignition).toBeNull();
    expect(empty.log).toEqual([]);
    expect(empty.days).toEqual([]);
  });
});

describe("formatSpan", () => {
  it("reads in hours on the first day and in days after", () => {
    expect(formatSpan(8 * 3_600_000)).toBe("8 h");
    expect(formatSpan(6.25 * 86_400_000)).toBe("6.3 d");
    expect(formatSpan(2 * 86_400_000)).toBe("2 d");
  });
});
