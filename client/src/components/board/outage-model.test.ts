import { describe, expect, it } from "vitest";
import { areaReports, clockWindows, distinctResources, mappedArea, utilityGroups } from "./outage-model";
import type { MapData, StatusGridData } from "@/lib/spec";

describe("outage reports across topics", () => {
  it("groups another topic's services without merging scopes or deleting history", () => {
    const services: StatusGridData["items"] = [
      { id: "1", name: "North district electricity", state: "down", note: "", asOf: "2026-11-14", sources: [] },
      { id: "2", name: "South district power", state: "operational", note: "", asOf: "2026-11-15", sources: [] },
      { id: "3", name: "Electric transport", state: "down", note: "", asOf: null, sources: [] },
      { id: "4", name: "Internet", state: "degraded", note: "", asOf: null, sources: [] },
    ];
    const result = utilityGroups(services);
    expect(result.find(g => g.key === "power")?.reports.map(r => r.id)).toEqual(["2", "1"]);
    expect(result.find(g => g.key === "transport")?.latest.id).toBe("3");
    expect(result.find(g => g.key === "communications")?.latest.id).toBe("4");
    expect(services.map(r => r.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("does not invent schedule dates or timezones from report timestamps", () => {
    const [r] = areaReports([{ title: "Regional power status", data: { columns: [
      { key: "area", label: "Area", kind: "text" }, { key: "state", label: "State", kind: "status" }, { key: "window", label: "Window", kind: "text" },
    ], rows: [{ id: "x", cells: { area: "Example zone", state: "Scheduled outages", window: "02:00-04:00" }, asOf: "2026-11-14T00:00:00Z", sources: ["s1"] }] } }]);
    expect(r.scheduleDate).toBe(""); expect(r.timezone).toBe(""); expect(r.windows).toBe("02:00-04:00"); expect(r.sources).toEqual(["s1"]);
  });
  it("does not classify shelter status as outage status", () => {
    expect(areaReports([{ title: "Shelters", data: { columns: [{ key: "district", label: "District", kind: "text" }, { key: "status", label: "Status", kind: "status" }], rows: [] } }])).toEqual([]);
  });
  it("splits overnight ranges and leaves unreported gaps uncolored", () => {
    expect(clockWindows("22:30–02:00, 11:00-15:00")).toEqual([{ start: 1350, end: 1440 }, { start: 0, end: 120 }, { start: 660, end: 900 }]);
    expect(clockWindows("25:00-27:00, 02:75-04:00, 12:00-24:30")).toEqual([]);
    expect(clockWindows("Not specified")).toEqual([]);
  });
  it("does not invent coordinates for a queue or multi-district report", () => {
    const map: MapData = { center: null, points: [{ id: "1", name: "Example City", lat: 1, lon: 2, kind: "impact", note: "", sources: [], asOf: null }] };
    expect(mappedArea("Example City", map)?.id).toBe("1");
    expect(mappedArea("Example City - Queue 1", map)).toBeUndefined();
    expect(mappedArea("Example City and another district", map)).toBeUndefined();
  });
  it("deduplicates resource destinations and excludes unsafe schemes", () => {
    const item = { id: "a", kind: "official" as const, label: "Operator", note: "", sources: [] };
    expect(distinctResources([{ ...item, url: "https://example.com/status/" }, { ...item, id: "b", url: "https://example.com/status" }, { ...item, id: "c", url: "javascript:void(0)" }])).toHaveLength(1);
  });
});
