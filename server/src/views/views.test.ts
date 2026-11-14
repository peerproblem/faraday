import { describe, expect, it, vi } from "vitest";
import { emptyLayout, LAYOUT_LIMITS, type BoardSpecV2, type Plan } from "../spec";
import { buildPrompt, editLayout, requestSentence, type LayoutEditOutput } from "./edit-layout";
import { extraKeyOf, sanitizeLayout } from "./sanitize";

const w = (id: string, type: string, bind: string | null = null, metrics: string[] = [], key?: string) =>
  ({ id, type, title: type, span: "full", bind, metrics, ...(key ? { key } : {}) }) as BoardSpecV2["widgets"][number];

const spec: BoardSpecV2 = {
  version: 2,
  widgets: [
    w("w1", "narrative", null, [], "narrative"),
    w("w2", "stat-grid", null, ["deaths", "evacuated", "homes"], "stat-grid"),
    w("w3", "trend", "deaths", [], "trend:deaths"),
    w("w4", "map", null, [], "map"),
    // An old spec without keys: widgetKeyOf computes them.
    w("w5", "table", "shelters"),
    w("w6", "timeline"),
    w("w7", "alert-list"),
    w("w8", "feed"),
  ],
};
const plan = { metrics: [{ key: "deaths", label: "Deaths" }, { key: "evacuated", label: "Evacuated" }, { key: "homes", label: "Homes destroyed" }], tables: [] } as unknown as Plan;

describe("sanitizeLayout", () => {
  it("drops keys the baseline does not have and dedupes lists", () => {
    const l = sanitizeLayout(
      { order: ["map", "ghost", "map", "table:shelters"], hidden: ["gone", "feed"], pinned: ["narrative", "narrative"], size: { map: "half", ghost: "full", feed: "wide" } },
      spec,
      plan,
    );
    expect(l.order).toEqual(["map", "table:shelters"]);
    expect(l.hidden).toEqual(["feed"]);
    expect(l.pinned).toEqual(["narrative"]);
    expect(l.size).toEqual({ map: "half" });
  });

  it("never pins a hidden widget", () => {
    expect(sanitizeLayout({ hidden: ["map"], pinned: ["map", "narrative"] }, spec, plan).pinned).toEqual(["narrative"]);
  });

  it("caps list lengths", () => {
    const many = Array.from({ length: 100 }, (_, i) => `trend:m${i}`);
    const big: BoardSpecV2 = { version: 2, widgets: many.map((k, i) => w(`w${i}`, "trend", k.slice(6), [], k)) };
    expect(sanitizeLayout({ order: many }, big, null).order).toHaveLength(LAYOUT_LIMITS.keys);
  });

  it("keeps filters only when the kind matches the widget and the values exist", () => {
    const l = sanitizeLayout(
      {
        filters: {
          timeline: { kind: "timeline", minImportance: "high" },
          map: { kind: "map", pointKinds: ["shelter", "volcano", "shelter"] },
          "table:shelters": { kind: "table", query: `  ${"x".repeat(500)}  ` },
          "alert-list": { kind: "alert-list", activeOnly: true },
          "stat-grid": { kind: "stat-grid", metrics: ["homes", "made-up", "deaths"] },
          feed: { kind: "feed", sourceTypes: ["official", "rumour"] },
          narrative: { kind: "narrative" },
          "trend:deaths": { kind: "timeline", minImportance: "high" },
          ghost: { kind: "map", pointKinds: ["shelter"] },
        },
      },
      spec,
      plan,
    );
    expect(l.filters).toEqual({
      timeline: { kind: "timeline", minImportance: "high" },
      map: { kind: "map", pointKinds: ["shelter"] },
      "table:shelters": { kind: "table", query: "x".repeat(LAYOUT_LIMITS.queryChars) },
      "alert-list": { kind: "alert-list", activeOnly: true },
      "stat-grid": { kind: "stat-grid", metrics: ["homes", "deaths"] },
      feed: { kind: "feed", sourceTypes: ["official"] },
    });
  });

  it("drops filters that would show nothing different", () => {
    const l = sanitizeLayout(
      { filters: { map: { kind: "map", pointKinds: [] }, "table:shelters": { kind: "table", query: "  " }, timeline: { kind: "timeline", minImportance: "low" } } },
      spec,
      plan,
    );
    expect(l.filters).toEqual({});
  });

  it("allows trend extras for stat-grid metrics without a baseline trend, one per metric, with stable keys", () => {
    const l = sanitizeLayout(
      {
        extras: [
          { type: "trend", metric: "evacuated", title: "" },
          { type: "trend", metric: "evacuated", title: "again" },
          { type: "trend", metric: "deaths", title: "has a trend already" },
          { type: "trend", metric: "unknown", title: "x" },
          { type: "pie", metric: "homes", title: "x" },
        ],
        order: [extraKeyOf("evacuated"), "map"],
      },
      spec,
      plan,
    );
    expect(l.extras).toEqual([{ key: "extra:trend:evacuated", type: "trend", metric: "evacuated", title: "Evacuated" }]);
    expect(l.order).toEqual(["extra:trend:evacuated", "map"]);
  });

  it("empties key lists while the board has no spec, and returns the empty layout for junk", () => {
    expect(sanitizeLayout({ order: ["map"], baseVersion: 4 }, null, null)).toEqual(emptyLayout(4));
    expect(sanitizeLayout("junk" as never, spec, plan)).toEqual(emptyLayout(0));
  });
});

const output = (over: Partial<LayoutEditOutput> = {}): LayoutEditOutput => ({
  reply: "Moved the map up.",
  order: ["map"],
  hidden: [],
  size: [],
  pinned: [],
  filters: [],
  extras: [],
  compactHeader: false,
  unsupported: [],
  ...over,
});

describe("editLayout", () => {
  const input = { spec, plan, layout: emptyLayout(3), instruction: "Map first", baseVersion: 5 };

  it("turns the flat model output into a sanitized layout", async () => {
    const model = vi.fn(async (_req: { system: string; prompt: string; signal: AbortSignal }) =>
      output({
        order: ["map", "nope"],
        hidden: ["feed"],
        size: [{ key: "map", span: "half" }],
        filters: [
          { key: "map", kind: "map", minImportance: null, pointKinds: ["shelter"], query: null, activeOnly: null, metrics: [], sourceTypes: [] },
          { key: "timeline", kind: "timeline", minImportance: "high", pointKinds: [], query: null, activeOnly: null, metrics: [], sourceTypes: [] },
          { key: "nope", kind: "map", minImportance: null, pointKinds: ["shelter"], query: null, activeOnly: null, metrics: [], sourceTypes: [] },
        ],
        extras: [{ metric: "homes", title: "Homes over time" }],
        compactHeader: true,
      }),
    );
    const r = await editLayout(input, AbortSignal.timeout(1000), model);
    expect(r.layout).toEqual({
      order: ["map"],
      hidden: ["feed"],
      size: { map: "half" },
      pinned: [],
      filters: { map: { kind: "map", pointKinds: ["shelter"] }, timeline: { kind: "timeline", minImportance: "high" } },
      extras: [{ key: "extra:trend:homes", type: "trend", metric: "homes", title: "Homes over time" }],
      header: { compact: true },
      baseVersion: 5,
    });
    expect(r.reply).toBe("Moved the map up.");
    expect(r.unsupported).toEqual([]);
    const prompt = model.mock.calls[0][0].prompt;
    expect(prompt).toContain('"key":"table:shelters"');
    expect(prompt).toContain("Request: Map first");
  });

  it("appends the English request sentence for unsupported parts", async () => {
    const r = await editLayout(input, AbortSignal.timeout(1000), async () => output({ unsupported: ["shelter capacity", "school closures"] }));
    expect(r.unsupported).toEqual(["shelter capacity", "school closures"]);
    expect(r.requests).toEqual(["shelter capacity", "school closures"]);
    expect(r.reply).toBe("Moved the map up. This topic doesn't track shelter capacity or school closures yet. I left a request.");
    expect(requestSentence(["a", "b", "c"])).toBe("This topic doesn't track a, b or c yet. I left a request.");
  });

  it("keeps the product English even when the model answers in Korean", async () => {
    const r = await editLayout(input, AbortSignal.timeout(1000), async () => output({ reply: "지도를 위로 옮겼어요", unsupported: ["대피소 수용 인원"] }));
    expect(r.reply).toBe("Updated your dashboard. This topic doesn't track some of what you asked for yet. I left a request.");
    expect(r.unsupported).toEqual([]);
    // Stored for admins as the person wrote it.
    expect(r.requests).toEqual(["대피소 수용 인원"]);
    expect(/[가-힯]/.test(r.reply)).toBe(false);
  });

  it("treats Japanese and Cyrillic replies as non-English too", async () => {
    const r = await editLayout(input, AbortSignal.timeout(1000), async () => output({ reply: "地図を上に移動しました", unsupported: ["вместимость приютов", "road closures"] }));
    expect(r.reply).toBe("Updated your dashboard. This topic doesn't track some of what you asked for yet. I left a request.");
    expect(r.unsupported).toEqual(["road closures"]);
    expect(r.requests).toEqual(["вместимость приютов", "road closures"]);
    const accented = await editLayout(input, AbortSignal.timeout(1000), async () => output({ reply: "Moved the café map up." }));
    expect(accented.reply).toBe("Moved the café map up.");
  });

  it("passes the abort signal to the model", async () => {
    const ac = new AbortController();
    const model = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal).toBe(ac.signal);
      return output();
    });
    await editLayout(input, ac.signal, model);
    expect(model).toHaveBeenCalledOnce();
  });

  it("describes widgets by stable key in the prompt", () => {
    expect(buildPrompt(spec, plan, emptyLayout(), "x")).toContain('"key":"trend:deaths"');
  });
});
