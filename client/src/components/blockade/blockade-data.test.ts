import { describe, expect, it } from "vitest";
import type { AlertListData, TableData } from "@/lib/spec";
import {
  advisorySides, bordersOf, crossingState, figureOf, hormuzArea, incidentDays, incidentKind, incidentKinds, incidentsOf,
  latestEvents, mapPoints,
} from "./blockade-data";

const cited = { sources: ["s1"], asOf: null };

const incidentTable: TableData = {
  columns: [
    { key: "vessel", label: "Vessel / Location", kind: "text" },
    { key: "action", label: "Action / Incident", kind: "text" },
    { key: "status", label: "Status", kind: "status" },
    { key: "time", label: "Time", kind: "time" },
  ],
  rows: [
    { id: "r1", cells: { vessel: "KYLO (Tanker) / Gulf of Oman", action: "Struck by US forces", status: "Sunk", time: "2026-09-05 13:38 UTC" }, sources: ["s1"], asOf: "2026-09-05T13:38:00Z" },
    { id: "r2", cells: { vessel: "Two oil tankers / Strait of Hormuz", action: "Hit naval mines", status: "On fire", time: "2026-11-14" }, sources: ["s2"], asOf: "2026-11-14T22:11:00Z" },
    { id: "r3", cells: { vessel: "3 oil tankers (Strait of Hormuz)", action: "Struck naval mines and caught fire", status: "On fire", time: "2026-11-15" }, sources: ["s3"], asOf: "2026-11-15T01:03:00Z" },
    { id: "r4", cells: { vessel: "4 vessels", action: "Stopped by IRGC Navy with warning shots", status: "Stopped", time: "Past 24 hours" }, sources: ["s4"], asOf: null },
  ],
};

const crossingTable: TableData = {
  columns: [
    { key: "crossing", label: "Crossing & Neighbor", kind: "text" },
    { key: "status", label: "Status", kind: "status" },
    { key: "restrictions", label: "Reported Restrictions", kind: "text" },
    { key: "updated", label: "Last Updated", kind: "time" },
  ],
  rows: [
    { id: "c1", cells: { crossing: "Turkey-Iran Border Crossings", status: "Open (unchanged)", restrictions: "No change" }, sources: ["s1"], asOf: "2026-11-12T03:02:29Z" },
    { id: "c2", cells: { crossing: "Iraq-Iran Border Crossings", status: "Partially closed", restrictions: "Some shut" }, sources: ["s1"], asOf: "2026-11-12T03:02:29Z" },
    { id: "c3", cells: { crossing: "Sheeb (Chazabeh) - Iraq", status: "Closed", restrictions: "Closed on October 21" }, sources: ["s2"], asOf: "2026-10-21T00:00:00Z" },
    { id: "c4", cells: { crossing: "al-Shayeb (Iraq-Iran)", status: "Closed", restrictions: "Security review" }, sources: ["s3"], asOf: "2026-10-20T00:00:00Z" },
    { id: "c5", cells: { crossing: "Mandali (Iraq)", status: "Expected to close", restrictions: "" }, sources: ["s4"], asOf: null },
    { id: "c6", cells: { crossing: "Taftan (Pakistan)", status: "Restricted", restrictions: "Trucks halted" }, sources: ["s5"], asOf: null },
  ],
};

describe("maritime incidents", () => {
  it("sorts reports newest first and keeps undated ones last", () => {
    expect(incidentsOf(incidentTable).map((incident) => incident.id)).toEqual(["r3", "r2", "r1", "r4"]);
  });

  it("classifies what a report describes", () => {
    expect(incidentKind("Two tankers hit naval mines")).toBe("mine");
    expect(incidentKind("Disabled by U.S. military strike after ignoring warnings")).toBe("enforcement");
    expect(incidentKind("Struck by an unknown projectile")).toBe("attack");
    expect(incidentKind("Complied with warnings and returned toward the Persian Gulf")).toBe("stopped");
    expect(incidentKind("Bring us the navigation equipment")).toBe("other");
  });

  it("counts kinds and reports per day", () => {
    const incidents = incidentsOf(incidentTable);
    expect(incidentKinds(incidents)).toContainEqual({ id: "mine", label: "Mine strikes", value: 2 });
    const days = incidentDays(incidents, Date.parse("2026-11-15T04:00:00Z"), 3);
    expect(days.map((entry) => entry.count)).toEqual([0, 1, 1]);
  });
});

describe("border crossings", () => {
  it("reads a status in the source's words", () => {
    expect(crossingState("Intermittently closed")).toBe("restricted");
    expect(crossingState("Partially open")).toBe("restricted");
    expect(crossingState("Expected to close")).toBe("pending");
    expect(crossingState("Closed")).toBe("closed");
    expect(crossingState("Open (unchanged)")).toBe("open");
  });

  it("groups by neighbour, merges reports on one crossing and sorts the most shut border first", () => {
    const borders = bordersOf(crossingTable);
    expect(borders.map((border) => [border.neighbor, border.state])).toEqual([["Iraq", "restricted"], ["Pakistan", "restricted"], ["Turkey", "open"]]);
    const iraq = borders[0];
    expect(iraq.overall.map((crossing) => crossing.id)).toEqual(["c2"]);
    expect(iraq.crossings.map((crossing) => crossing.id)).toEqual(["c3", "c5"]);
    expect(iraq.crossings[0].sources).toEqual(["s2", "s3"]);
  });
});

describe("map", () => {
  it("draws one marker per water and per named crossing, with the reports' sources", () => {
    const points = mapPoints([], incidentsOf(incidentTable), bordersOf(crossingTable));
    expect(points.map((point) => point.id).sort()).toEqual(["crossing:mandali", "crossing:sheeb", "crossing:taftan", "sea:gulf-of-oman", "sea:hormuz"]);
    const hormuz = points.find((point) => point.id === "sea:hormuz")!;
    expect(hormuz.note).toMatch(/^2 incident reports, latest 15 Nov/);
    expect(hormuz.sources).toEqual(["s3", "s2"]);
    expect(points.find((point) => point.id === "crossing:sheeb")).toMatchObject({ kind: "closure", layer: "land" });
  });

  it("draws the strait only while an active warning names it", () => {
    const advisory = { ...cited, id: "a1", issuer: "UKMTO", title: "Critical threat in Strait of Hormuz", text: "", level: "warning" as const, url: null, active: true };
    expect(hormuzArea([advisory])?.label).toBe("Strait of Hormuz");
    expect(hormuzArea([{ ...advisory, active: false }])).toBeNull();
    expect(hormuzArea([{ ...advisory, level: "info" }])).toBeNull();
  });
});

describe("overview", () => {
  it("counts active advisories by issuing side", () => {
    const item = (id: string, issuer: string, active = true): AlertListData["items"][number] =>
      ({ ...cited, id, issuer, title: id, text: "", level: "warning", url: null, active });
    const sides = advisorySides([item("a", "U.S. Central Command (CENTCOM)"), item("b", "IRGC Navy"), item("c", "MARAD"), item("d", "UKMTO", false)]);
    expect(sides).toEqual([{ id: "United States", label: "United States", value: 2 }, { id: "Iran", label: "Iran", value: 1 }]);
  });

  it("shows a number word as its digit and keeps other wording", () => {
    const stat = { ...cited, key: "k", label: "L", valueNum: 1, unit: null, delta: null, deltaNum: null, tone: "info" as const, conflict: null, history: [] };
    expect(figureOf({ ...stat, valueText: "one" }).value).toBe("1");
    expect(figureOf({ ...stat, valueText: "Nearly 150" }).value).toBe("Nearly 150");
  });

  it("leads with high-importance events, newest first", () => {
    const event = (id: string, at: string, importance: "high" | "medium") => ({ ...cited, id, at, title: id, detail: "", importance });
    const picked = latestEvents([event("a", "2026-11-15T03:00:00Z", "medium"), event("b", "2026-11-15T02:00:00Z", "high"), event("c", "2026-11-14T02:00:00Z", "high"), event("d", "2026-11-15T01:00:00Z", "medium")]);
    expect(picked.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});
