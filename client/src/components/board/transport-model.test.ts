import { describe, expect, it } from "vitest";
import type { AlertListData, TableData } from "@/lib/spec";
import { networkMilestone, noticeKind, statusTone, transportNotices, transportSections } from "./transport-model";

function table(label: string, rows: { name: string; status: string; asOf: string | null }[]): { title: string; data: TableData } {
  return { title: "Transport reports", data: {
    columns: [{ key: "name", label, kind: "text" }, { key: "state", label: "Status", kind: "status" }],
    rows: rows.map((row, i) => ({ id: String(i), asOf: row.asOf, sources: [`s${i}`], cells: { name: row.name, state: row.status } })),
  } };
}
describe("transport summaries preserve report scope and history", () => {
  it("groups airline name variants without making an undated conflicting report the latest", () => {
    const original = table("Airline", [
      { name: "Example Airlines", status: "Operational", asOf: null },
      { name: "Example", status: "Disrupted", asOf: "2026-11-15T01:00:00Z" },
      { name: "Example Airlines and Partner Airlines", status: "Recovering", asOf: null },
    ]);
    const before = JSON.stringify(original);
    const [, operators] = transportSections([original]);
    expect(operators.groups).toHaveLength(2);
    expect(operators.groups[0].reports.map(r => r.status)).toEqual(["Disrupted", "Operational"]);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("adapts rail routes and operators without flight-specific data or titles", () => {
    const sections = transportSections([
      table("Rail line", [{ name: "Line 2", status: "Suspended", asOf: "2026-11-15" }, { name: "Line 20", status: "Partial service", asOf: "2026-11-15" }]),
      table("Operator", [{ name: "Regional Rail", status: "Recovering", asOf: "2026-11-15" }]),
    ]);
    expect(sections.map(s => s.label)).toEqual(["Locations & routes", "Operators & services"]);
    expect(sections[0].groups).toHaveLength(2);
    expect(sections[1].groups[0].name).toBe("Regional Rail");
    expect(transportSections([table("Shelter", [{ name: "Hall", status: "Open", asOf: null }])])[0].groups).toHaveLength(0);
  });
  it("separates forecasts from restrictions and retains all duplicate notice sources", () => {
    const item: AlertListData["items"][number] = { id: "1", issuer: "Operator", title: "Possible closure", text: "Closures possible after 12:00", level: "watch", active: true, asOf: null, sources: ["s1"], url: null };
    expect(noticeKind(item)).toBe("Forecast");
    expect(noticeKind({ ...item, active: false })).toBe("Inactive");
    const notices = transportNotices([item, { ...item, id: "2", sources: ["s2"] }]);
    expect(notices).toHaveLength(1);
    expect(notices[0].sources).toEqual(["s1", "s2"]);
    expect(item.sources).toEqual(["s1"]);
    expect(statusTone("Partial closure")).toBe("warning");
    expect(statusTone("Reopening expected")).toBe("neutral");
    expect(statusTone("Active waiver")).toBe("neutral");
  });
  it("recognizes a lifting event without treating it as proof all service recovered", () => {
    const event = { id: "1", title: "Authority lifts nationwide ground stop", detail: "Schedules still disrupted", at: "2026-11-14T01:15:00Z", asOf: null, sources: ["s1"], importance: "high" as const };
    expect(networkMilestone({ items: [event] })).toEqual(event);
    expect(networkMilestone({ items: [{ ...event, at: null }] })).toBeUndefined();
  });
});
