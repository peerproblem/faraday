import { describe, expect, it } from "vitest";
import type { Source, StatItem, TrendData } from "@/lib/spec";
import { selectCyberTrend } from "./select-cyber-trend";
const source = { id: "s1", url: "https://example.com/report", snippet: "$3 billion frozen", title: "Report" } as Source;
const sources = new Map([[source.id, source]]);
const metric = (key: string, role: StatItem["cyberRole"] = "recovery") => ({ key, label: key, cyberRole: role, conflict: null }) as StatItem;
const trend = (key: string, unit = "systems"): TrendData => ({ metric: key, label: key, unit,
  points: [1, 2, 3].map((v, index) => ({ t: `2026-11-${10 + index}`, v, sources: ["s1"] })),
});
describe("cyber main chart eligibility", () => {
  it("selects recovery by semantic role rather than topic or metric wording", () => {
    const result = selectCyberTrend([trend("beta"), trend("alpha")], [metric("beta", "impact"), metric("alpha")], sources);
    expect(result?.metric).toBe("alpha");
    expect(result?.points.map(p => p.v)).toEqual([1, 2, 3]);
  });
  it("excludes percentages without denominator metadata and context metrics", () => {
    expect(selectCyberTrend([trend("alpha", "%")], [metric("alpha")], sources)).toBeUndefined();
    expect(selectCyberTrend([trend("alpha")], [metric("alpha", "context")], sources)).toBeUndefined();
  });
  it("does not silently drop missing, unsourced or conflicting observations", () => {
    const data = trend("alpha");
    expect(selectCyberTrend([{ ...data, points: data.points.slice(0, 2) }], [metric("alpha")], sources)).toBeUndefined();
    expect(selectCyberTrend([{ ...data, points: [...data.points, { t: "2026-11-13", v: 4, sources: ["missing"] }] }], [metric("alpha")], sources)).toBeUndefined();
    expect(selectCyberTrend([{ ...data, points: [...data.points, { ...data.points[0], v: 100 }] }], [metric("alpha")], sources)).toBeUndefined();
    expect(selectCyberTrend([{ ...data, unit: null }], [metric("alpha")], sources)).toBeUndefined();
  });
  it("normalizes dollar scale only with cited evidence", () => {
    const data = trend("alpha", "USD millions");
    data.points = data.points.map((point, index) => ({ ...point, v: index === 0 ? 3 : 3_000_000_000 }));
    const result = selectCyberTrend([data], [metric("alpha", "response")], sources);
    expect(result?.unit).toBe("USD");
    expect(result?.points.every(point => point.v === 3_000_000_000)).toBe(true);
    expect(selectCyberTrend([data], [metric("alpha")], new Map([[source.id, { ...source, snippet: "No amount given" }]]))).toBeUndefined();
  });
  it("rejects disputed metrics and deduplicates identical simultaneous readings", () => {
    const data = trend("alpha");
    expect(selectCyberTrend([data], [{ ...metric("alpha"), conflict: [{ valueText: "50", sources: ["s1"] }] }], sources)).toBeUndefined();
    expect(selectCyberTrend([{ ...data, points: [...data.points, data.points[0]] }], [metric("alpha")], sources)?.points).toHaveLength(3);
  });
});
