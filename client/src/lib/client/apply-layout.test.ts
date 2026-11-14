import { describe, expect, test } from "vitest";
import { emptyLayout, type BoardData, type BoardSpecV2, type PersonalLayout, type Widget } from "@/lib/spec";
import { applyLayout, moveKey, settleLayout } from "./apply-layout";

const w = (id: string, type: Widget["type"], bind: string | null = null, span: "full" | "half" = "half"): Widget => ({
  id,
  type,
  title: `${type}${bind ? `:${bind}` : ""}`,
  span,
  bind,
  metrics: [],
});

const spec = (widgets: Widget[]): BoardSpecV2 => ({ version: 2, widgets });
const base = spec([
  w("w1", "narrative", null, "full"),
  w("w2", "stat-grid", null, "full"),
  w("w3", "map", null, "full"),
  w("w4", "table", "shelters", "full"),
  w("w5", "timeline"),
  w("w6", "feed"),
  w("w7", "sources", null, "full"),
]);
const data: BoardData = {
  header: { title: "T", subtitle: null, crisisType: "flood", language: "en" } as BoardData["header"],
  widgets: {
    w2: {
      items: [
        {
          key: "deaths",
          label: "Deaths",
          valueText: "15",
          valueNum: 15,
          unit: null,
          delta: null,
          deltaNum: null,
          tone: "critical",
          conflict: null,
          history: [
            { t: "2026-11-14T08:00:00Z", v: 4 },
            { t: "2026-11-14T10:00:00Z", v: 15 },
          ],
          sources: ["s1"],
          asOf: null,
        },
      ],
    },
  },
  hidden: [],
  generatedAt: 0,
};
const layout = (patch: Partial<PersonalLayout>): PersonalLayout => ({ ...emptyLayout(3), ...patch });
const keys = (l: PersonalLayout | null, s = base, d: BoardData | null = data, version?: number) =>
  applyLayout(s, d, l, { version }).widgets.map((x) => x.key);

describe("applyLayout", () => {
  test("no layout keeps the baseline order", () => {
    expect(keys(null)).toEqual(["narrative", "stat-grid", "map", "table:shelters", "timeline", "feed", "sources"]);
  });

  test("keys the baseline no longer has are ignored", () => {
    expect(keys(layout({ order: ["gone", "map", "narrative"], hidden: ["also-gone"], pinned: ["nope"] }))[0]).toBe("map");
    expect(keys(layout({ order: ["gone"] }))).toEqual(keys(null));
  });

  test("pinned come first, then order, and hidden are dropped", () => {
    expect(keys(layout({ pinned: ["timeline"], order: ["map", "narrative", "stat-grid"], hidden: ["feed"] }))).toEqual([
      "timeline",
      "map",
      "table:shelters",
      "narrative",
      "stat-grid",
      "sources",
    ]);
  });

  test("a baseline widget the layout does not place goes after its baseline predecessor", () => {
    // table:shelters is missing from the order; its predecessor map is placed, so it lands right after it.
    expect(keys(layout({ order: ["timeline", "map", "narrative", "stat-grid", "feed", "sources"] }))).toEqual([
      "timeline",
      "map",
      "table:shelters",
      "narrative",
      "stat-grid",
      "feed",
      "sources",
    ]);
  });

  test("a new widget with no placed predecessor goes before the tail", () => {
    const s = spec([w("w0", "alert-list"), ...base.widgets]);
    expect(keys(layout({ order: ["map", "feed", "sources"], hidden: ["narrative", "stat-grid", "table:shelters", "timeline"] }), s)).toEqual([
      "map",
      "alert-list",
      "feed",
      "sources",
    ]);
  });

  test("size overrides the span", () => {
    const r = applyLayout(base, data, layout({ size: { map: "half", timeline: "full" } }));
    expect(r.widgets.find((x) => x.key === "map")!.widget.span).toBe("half");
    expect(r.widgets.find((x) => x.key === "timeline")!.widget.span).toBe("full");
  });

  test("extras sit after the stat grid unless ordered, and disappear when the metric does", () => {
    const ex = { key: "trend:deaths-mine", type: "trend" as const, metric: "deaths", title: "Deaths" };
    expect(keys(layout({ extras: [ex] })).slice(0, 3)).toEqual(["narrative", "stat-grid", "trend:deaths-mine"]);
    expect(keys(layout({ extras: [ex], order: ["trend:deaths-mine", "narrative"] })).slice(0, 2)).toEqual(["trend:deaths-mine", "narrative"]);
    const r = applyLayout(base, data, layout({ extras: [ex] }));
    const x = r.widgets.find((v) => v.key === ex.key)!;
    expect(x.widget.type).toBe("trend");
    expect((x.data as { points: unknown[] }).points).toHaveLength(2);
    expect(keys(layout({ extras: [{ ...ex, metric: "gone" }] }))).not.toContain(ex.key);
    expect(keys(layout({ extras: [ex] }), base, null)).not.toContain(ex.key);
  });

  test("filters are passed to the matching widget only", () => {
    const r = applyLayout(
      base,
      data,
      layout({ filters: { timeline: { kind: "timeline", minImportance: "high" }, map: { kind: "timeline", minImportance: "high" } } }),
    );
    expect(r.widgets.find((x) => x.key === "timeline")!.filter).toEqual({ kind: "timeline", minImportance: "high" });
    expect(r.widgets.find((x) => x.key === "map")!.filter).toBeUndefined();
  });

  test("widgets added after baseVersion are marked new", () => {
    const s = spec([...base.widgets.slice(0, 3), w("w9", "alert-list"), ...base.widgets.slice(3)]);
    const saved = layout({ order: keys(null), baseVersion: 3 });
    const r = applyLayout(s, data, saved, { version: 4 });
    expect(r.widgets.filter((x) => x.isNew).map((x) => x.key)).toEqual(["alert-list"]);
    expect(r.widgets.map((x) => x.key).indexOf("alert-list")).toBe(3);
    expect(applyLayout(s, data, saved, { version: 3 }).widgets.some((x) => x.isNew)).toBe(false);
    expect(applyLayout(s, data, null, { version: 9 }).widgets.some((x) => x.isNew)).toBe(false);
  });

  test("compact header", () => {
    expect(applyLayout(base, data, layout({ header: { compact: true } })).compactHeader).toBe(true);
    expect(applyLayout(base, data, null).compactHeader).toBe(false);
  });
});

describe("settleLayout and moveKey", () => {
  test("settle writes the full order and moves baseVersion", () => {
    const s = settleLayout(base, data, layout({ pinned: ["map"], baseVersion: 1 }), 5);
    expect(s.order).toEqual(["narrative", "stat-grid", "table:shelters", "timeline", "feed", "sources"]);
    expect(s.baseVersion).toBe(5);
  });

  test("moveKey swaps neighbours and stops at the ends", () => {
    const applied = applyLayout(base, data, null);
    expect(moveKey(applied, "map", -1).slice(0, 3)).toEqual(["narrative", "map", "stat-grid"]);
    expect(moveKey(applied, "narrative", -1)[0]).toBe("narrative");
    expect(moveKey(applied, "sources", 1).at(-1)).toBe("sources");
  });
});
