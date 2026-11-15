import { describe, expect, it } from "vitest";
import type { BoardData, StatItem, Widget } from "@/lib/spec";
import {
  cityMarches, figureValue, serviceLevels, steadyHistory, strikeActors, strikeDay, strikeFigures, turnoutClaims, upcomingVote,
} from "./strike-data";

function stat(key: string, label: string, valueText: string, valueNum: number | null, unit: string | null, extra: Partial<StatItem> = {}): StatItem {
  return { key, label, valueText, valueNum, unit, delta: null, deltaNum: null, tone: "info", conflict: null, history: [], sources: ["s1"], asOf: null, ...extra };
}

const widgets = [
  { id: "figures", type: "stat-grid", title: "Key figures" },
  { id: "cities", type: "table", title: "Cities" },
  { id: "transport", type: "table", title: "Transport" },
  { id: "actors", type: "table", title: "Actors" },
  { id: "events", type: "timeline", title: "Timeline" },
] as Widget[];

const row = (id: string, cells: Record<string, string>, asOf: string | null = null) => ({ id, cells, asOf, sources: [`s-${id}`] });

const data = {
  widgets: {
    figures: {
      items: [
        stat("strike-turnout", "Strike Turnout", "35,04%", 35.04, "%", { conflict: [{ valueText: "85%", sources: ["s151"] }, { valueText: "38%", sources: ["s151"] }] }),
        stat("protest-attendance", "Total Protesters", "unas 120.000", 120000, "people", { evidence: { source: "s31", quote: "In Madrid, about 120,000 people marched." } }),
        stat("trains-cancelled", "Trains Cancelled", "111", 111, "trains"),
        stat("flights-cancelled", "Flights Cancelled", "> 280", 280, "flights"),
        stat("arrests-incidents", "Arrests & Incidents", "at least 115", 115, "count"),
      ],
    },
    cities: {
      columns: [{ key: "city", label: "City", kind: "text" }, { key: "attendance", label: "Attendance", kind: "number" }, { key: "status", label: "Status", kind: "status" }],
      rows: [
        row("bcn", { city: "Barcelona", attendance: "Tens of thousands", status: "Clashes at end of protests" }),
        row("mad", { city: "Madrid", attendance: "120,000 (Government Delegation)", status: "Police charges at 21:00" }),
        row("south", { city: "Cádiz, Huelva, Córdoba, Sevilla", attendance: "Suspended", status: "Suspended due to bad weather" }),
        row("cor", { city: "A Coruña", attendance: "Over 45,000 (City Council)", status: "Held" }),
        row("val", { city: "Valencia", attendance: "Unknown", status: "Unions marched" }),
        row("south-again", { city: "Cádiz and Huelva", attendance: "0", status: "Suspended due to weather" }),
      ],
    },
    transport: {
      columns: [{ key: "service", label: "Service", kind: "text" }, { key: "operator", label: "Operator", kind: "text" }, { key: "minimum-service", label: "Minimum Service", kind: "text" }, { key: "status", label: "Status", kind: "status" }],
      rows: [
        row("metro", { service: "Metro", operator: "Madrid Metro", "minimum-service": "93% of trains ran in early morning", status: "Operating" }, "2026-11-12T04:05:13.000Z"),
        row("metro-old", { service: "Madrid Metro", operator: "Madrid Metro", "minimum-service": "50% of normal service", status: "Reduced" }, "2026-11-11T15:58:09.000Z"),
        row("range", { service: "Trains", operator: "National rail", "minimum-service": "50% to 75% of normal service", status: "Reduced" }, "2026-11-11T16:06:09.000Z"),
        row("ave", { service: "High-speed rail (AVE)", operator: "Renfe", "minimum-service": "73% (65% medium-distance)", status: "24% cancelled" }, "2026-11-11T12:26:00.000Z"),
        row("ave-again", { service: "AVE and long-distance rail", operator: "Renfe", "minimum-service": "73%", status: "Minimum services set" }),
        row("peak", { service: "Commuter rail", operator: "Renfe", "minimum-service": "75% peak / 50% off-peak", status: "Uneven" }),
        row("care", { service: "Summa 112", operator: "Madrid Regional Health Service", "minimum-service": "100% of scheduled care staff", status: "Active" }),
        row("cancelled", { service: "Flights", operator: "AENA", "minimum-service": "Around 5% of flights cancelled", status: "Disrupted" }),
      ],
    },
    actors: {
      columns: [{ key: "actor", label: "Actor", kind: "text" }, { key: "position", label: "Position / Action", kind: "text" }, { key: "status", label: "Status", kind: "status" }],
      rows: [
        row("ceoe", { actor: "Employers (CEOE)", position: "Called strike a 'failure' with average turnout under 5%", status: "Opposed" }),
        row("unions", { actor: "Unions (CCOO, UGT, etc.)", position: "Called 24h strike for housing access; called it 'very successful'", status: "Strike held on 11-N" }),
        row("patronal", { actor: "Employers' association (La patronal)", position: "Called the strike a \"failure\" with turnout below 5%", status: "Opposed" }),
        row("pp", { actor: "Popular Party (Alberto Nunez Feijoo)", position: "Called the strike a historic mistake by unions", status: "Opposed" }),
        row("gov", { actor: "Pedro Sánchez", position: "Encourages the general strike", status: "Supportive" }),
        row("other", { actor: "Aena", position: "Published the cancellations", status: "Informing" }),
      ],
    },
    events: {
      items: [
        { id: "e1", at: "2026-11-11T09:11:21.794Z", title: "Snap elections scheduled for November 29", detail: "Elections are set for November 29.", importance: "high", sources: ["s1"], asOf: null },
        { id: "e2", at: "2026-11-11T09:52:00.000Z", title: "Roadblocks reported", detail: "", importance: "high", sources: [], asOf: null },
        { id: "e3", at: "2026-11-11T20:03:00.000Z", title: "Marches begin", detail: "", importance: "medium", sources: [], asOf: null },
        { id: "e4", at: "2026-11-11T20:46:00.000Z", title: "Clashes erupt", detail: "", importance: "high", sources: [], asOf: null },
        { id: "e5", at: "2026-11-11T00:00:00.000Z", title: "Strike begins", detail: "", importance: "high", sources: [], asOf: null },
        { id: "e6", at: "2026-11-11", title: "Minimum services decreed", detail: "", importance: "medium", sources: [], asOf: null },
        { id: "e7", at: "2026-10-31T10:00:00.000Z", title: "Strike called", detail: "", importance: "medium", sources: [], asOf: null },
      ],
    },
  },
} as unknown as BoardData;

describe("general strike board data", () => {
  it("shows figures in English digits, in a fixed order, without the disputed turnout", () => {
    const figures = strikeFigures((data.widgets.figures as { items: StatItem[] }).items);
    expect(figures.map((figure) => [figure.label, figure.value])).toEqual([
      ["Madrid march", "120,000"], ["Flights cancelled", "280+"], ["Trains cancelled", "111"], ["Arrests", "115+"],
    ]);
    expect(figureValue(stat("turnout", "Turnout", "35,04%", 35.04, "%"))).toBe("35.04%");
    expect(figureValue(stat("status", "Status", "Suspended", null, null))).toBe("Suspended");
  });

  it("drops a report that is several times every other one from a figure's history", () => {
    const history = [50, 40, 1044, 70, 115].map((v, index) => ({ t: `2026-11-11T0${index}:00:00.000Z`, v }));
    expect(steadyHistory(history)).toEqual([50, 40, 70, 115]);
  });

  it("pairs the unions' best sector with the employers' average, and only when both are reported", () => {
    const claims = turnoutClaims(widgets, data);
    expect(claims?.unions).toMatchObject({ value: 85, bound: "up to", sources: ["s151"] });
    expect(claims?.employers).toMatchObject({ value: 5, bound: "under", sources: ["s-ceoe"] });
    expect(turnoutClaims(widgets.filter((widget) => widget.id !== "actors"), data)).toBeNull();
  });

  it("lists each city once, counted marches first and suspended ones last", () => {
    const marches = cityMarches(widgets, data);
    expect(marches.map((march) => march.city)).toEqual(["Madrid", "A Coruña", "Barcelona", "Cádiz, Huelva, Córdoba, Sevilla"]);
    expect(marches.map((march) => march.attendance)).toEqual(["120,000", "Over 45,000", "Tens of thousands", null]);
    expect(marches.map((march) => march.tone)).toEqual(["danger", "neutral", "danger", "warning"]);
  });

  it("keeps one stated service level per transport line, newest report first", () => {
    expect(serviceLevels(widgets, data)).toEqual([
      { id: "metro", label: "Madrid Metro", value: 93 },
      { id: "ave", label: "High-speed rail (AVE)", value: 73 },
    ]);
  });

  it("folds the names of one actor together and leaves out actors without a side", () => {
    const actors = strikeActors(widgets, data);
    expect(actors.map((actor) => [actor.name, actor.stance])).toEqual([
      ["Employers (CEOE)", "against"],
      ["Unions (CCOO, UGT, CGT, CNT)", "for"],
      ["Popular Party (Feijóo)", "against"],
      ["Spanish government (Sánchez)", "for"],
    ]);
  });

  it("reads the election date from the timeline", () => {
    expect(upcomingVote(widgets, data)).toMatchObject({ date: "2026-11-29T00:00:00.000Z", sources: ["s1"] });
  });

  it("counts timed events of the busiest day by UTC hour", () => {
    const timeline = data.widgets.events as Parameters<typeof strikeDay>[0];
    const day = strikeDay(timeline);
    expect(day?.day).toBe("2026-11-11");
    expect(day?.hours[9]).toMatchObject({ count: 2, high: 2 });
    expect(day?.hours[20]).toMatchObject({ count: 2, high: 1 });
    expect(day?.hours[0].count).toBe(0);
    expect(strikeDay({ items: timeline!.items.slice(0, 2) })).toBeNull();
  });
});
