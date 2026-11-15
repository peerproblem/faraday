import { describe, expect, it } from "vitest";
import { ogCard, ogImagePath, ogTime, pickStats } from "./og";
import type { BoardView } from "./spec";
import type { StatItem } from "./spec/widgets";

const stat = (key: string, tone: StatItem["tone"], valueText = "12"): StatItem => ({
  key, label: key, valueText, valueNum: 12, unit: null, delta: null, deltaNum: null, tone, conflict: null, history: [], sources: [], asOf: null,
});
const board = (items: StatItem[], hidden: string[] = []) => ({
  title: "t",
  updatedAt: 1,
  spec: { version: 2, widgets: [{ id: "stats", type: "stat-grid", title: "Figures", span: "full", bind: null, metrics: [] }] },
  data: {
    header: { title: "Valencia floods", subtitle: null, crisisType: "flood", accent: "blue", headline: { text: "Rivers are still rising.", sources: [] }, status: "ongoing",
      statusP: null, severity: 4, severityP: null, location: { name: "Valencia", lat: 0, lon: 0, zoom: 6 }, asOf: null, language: "en" },
    widgets: { stats: { items } }, hidden, generatedAt: Date.UTC(2026, 10, 15, 14, 5),
  },
}) as unknown as Pick<BoardView, "title" | "spec" | "data" | "updatedAt">;

describe("board share image", () => {
  it("shows the three most severe figures, keeping the board's order within a tone", () => {
    const b = board([stat("a", "info"), stat("b", "critical"), stat("c", "warning"), stat("d", "critical"), stat("e", "ok")]);
    expect(pickStats(b).map((s) => s.label)).toEqual(["b", "d", "c"]);
  });
  it("shows no figures from a hidden grid or empty values", () => {
    expect(pickStats(board([stat("a", "info")], ["stats"]))).toEqual([]);
    expect(pickStats(board([stat("a", "info", " ")]))).toEqual([]);
  });
  it("takes the title, place, headline and accent from the board header", () => {
    expect(ogCard(board([]))).toMatchObject({ title: "Valencia floods", kicker: "Flood, Valencia", headline: "Rivers are still rising.", status: "ongoing", accent: "#3b82f6" });
  });
  it("writes an absolute time and a versioned image path", () => {
    expect(ogTime(Date.UTC(2026, 10, 15, 14, 5))).toBe("15 Nov, 14:05 UTC");
    expect(ogImagePath("valencia-floods", 7)).toBe("/api/og/valencia-floods?v=7");
  });
});
