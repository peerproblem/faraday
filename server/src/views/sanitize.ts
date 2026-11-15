// Validation and cleanup of personal layouts. Imports only spec/ so the api can use it.
import { z } from "zod";
import {
  boardDesigns,
  LAYOUT_LIMITS,
  sourceTypes,
  widgetKeyOf,
  type BoardSpecV2,
  type ExtraWidget,
  type MapPointKind,
  type PersonalLayout,
  type Plan,
  type SourceType,
  type Widget,
  type WidgetFilter,
  type WidgetKey,
} from "../spec";

export const MAP_POINT_KINDS: readonly MapPointKind[] = ["impact", "incident", "shelter", "closure", "resource", "origin"];

const boardDesign = z.enum(boardDesigns);
const keyList = z.array(z.string().max(200)).max(200);

/** Shape check for a layout from a request. Loose on purpose: sanitizeLayout does the real cleanup. */
export const layoutInputSchema = z.object({
  order: keyList.default([]),
  hidden: keyList.default([]),
  size: z.record(z.string().max(200), z.string().max(16)).default({}),
  pinned: keyList.default([]),
  filters: z.record(z.string().max(200), z.object({ kind: z.string().max(32) }).passthrough()).default({}),
  extras: z
    .array(z.object({ key: z.string().max(200).optional(), type: z.string().max(16), metric: z.string().max(200), title: z.string().max(500).optional() }))
    .max(50)
    .default([]),
  design: z.unknown().optional().transform((value) => boardDesign.safeParse(value).data),
  overviewChart: z.unknown().optional().transform((value) =>
    z.object({ type: z.literal("donut"), widget: z.string().max(200) }).safeParse(value).data,
  ),
  header: z.object({ compact: z.boolean().default(false) }).default({ compact: false }),
  baseVersion: z.number().int().min(0).max(1e9).default(0),
});
export type LayoutInput = z.input<typeof layoutInputSchema>;

/** The key a trend extra gets. Distinct from a baseline trend widget's key (`trend:<metric>`). */
export const extraKeyOf = (metric: string) => `extra:trend:${metric}`;

const uniq = <T>(xs: T[]) => [...new Set(xs)];

type Ctx = { widgets: Map<WidgetKey, Widget>; statMetrics: string[]; metricLabel: Map<string, string> };

function context(spec: BoardSpecV2 | null, plan: Plan | null): Ctx {
  const widgets = new Map<WidgetKey, Widget>();
  for (const w of spec?.widgets ?? []) widgets.set(widgetKeyOf(w), w);
  const stat = [...widgets.values()].find((w) => w.type === "stat-grid");
  const statMetrics = stat?.metrics ?? [];
  const metricLabel = new Map((plan?.metrics ?? []).map((m) => [m.key, m.label]));
  return { widgets, statMetrics, metricLabel };
}

function cleanFilter(raw: unknown, w: Widget): WidgetFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (f.kind !== w.type) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  switch (w.type) {
    case "timeline":
      return f.minImportance === "high" || f.minImportance === "medium" ? { kind: "timeline", minImportance: f.minImportance } : null;
    case "map": {
      const kinds = uniq(strings(f.pointKinds)).filter((k): k is MapPointKind => (MAP_POINT_KINDS as readonly string[]).includes(k));
      return kinds.length ? { kind: "map", pointKinds: kinds.slice(0, LAYOUT_LIMITS.filterTerms) } : null;
    }
    case "table": {
      const q = typeof f.query === "string" ? f.query.trim().slice(0, LAYOUT_LIMITS.queryChars) : "";
      return q ? { kind: "table", query: q } : null;
    }
    case "alert-list":
      return f.activeOnly === true ? { kind: "alert-list", activeOnly: true } : null;
    case "stat-grid": {
      const allowed = new Set(w.metrics);
      const metrics = uniq(strings(f.metrics)).filter((m) => allowed.has(m));
      return metrics.length ? { kind: "stat-grid", metrics: metrics.slice(0, LAYOUT_LIMITS.filterTerms) } : null;
    }
    case "feed": {
      const types = uniq(strings(f.sourceTypes)).filter((t): t is SourceType => (sourceTypes as readonly string[]).includes(t));
      return types.length ? { kind: "feed", sourceTypes: types.slice(0, LAYOUT_LIMITS.filterTerms) } : null;
    }
    default:
      return null;
  }
}

/**
 * Turns any layout-shaped input into a PersonalLayout that only refers to what the board has now:
 * - keys not on the baseline (nor an extra) are dropped from order, hidden, pinned, size and filters;
 * - lists are deduplicated and capped by LAYOUT_LIMITS;
 * - filters must match the widget type and only name values the widget can show;
 * - extras are trends of metrics the stat-grid shows that have no baseline trend widget, one per metric;
 * - a hidden key is never pinned.
 * Without a spec (board still building) every key list is emptied.
 */
export function sanitizeLayout(input: LayoutInput | PersonalLayout, spec: BoardSpecV2 | null, plan: Plan | null): PersonalLayout {
  const parsed = layoutInputSchema.safeParse(input);
  // Input that is not layout-shaped at all becomes the empty layout.
  const raw = parsed.success ? parsed.data : layoutInputSchema.parse({});
  const ctx = context(spec, plan);

  const extras: ExtraWidget[] = [];
  const statSet = new Set(ctx.statMetrics);
  for (const e of raw.extras) {
    if (extras.length >= LAYOUT_LIMITS.extras) break;
    if (e.type !== "trend" || !statSet.has(e.metric)) continue;
    if (ctx.widgets.has(`trend:${e.metric}`)) continue;
    const key = extraKeyOf(e.metric);
    if (extras.some((x) => x.key === key)) continue;
    const title = (e.title ?? "").trim().slice(0, LAYOUT_LIMITS.titleChars) || ctx.metricLabel.get(e.metric) || e.metric;
    extras.push({ key, type: "trend", metric: e.metric, title });
  }

  const known = new Set<WidgetKey>([...ctx.widgets.keys(), ...extras.map((e) => e.key)]);
  const keys = (xs: string[]) => uniq(xs.filter((k) => known.has(k))).slice(0, LAYOUT_LIMITS.keys);

  const hidden = keys(raw.hidden);
  const hiddenSet = new Set(hidden);
  const pinned = keys(raw.pinned).filter((k) => !hiddenSet.has(k));
  const order = keys(raw.order);

  const size: PersonalLayout["size"] = {};
  for (const [k, v] of Object.entries(raw.size)) {
    if (Object.keys(size).length >= LAYOUT_LIMITS.keys) break;
    if (known.has(k) && (v === "full" || v === "half")) size[k] = v;
  }

  const filters: PersonalLayout["filters"] = {};
  for (const [k, f] of Object.entries(raw.filters)) {
    if (Object.keys(filters).length >= LAYOUT_LIMITS.keys) break;
    const w = ctx.widgets.get(k);
    if (!w) continue;
    const clean = cleanFilter(f, w);
    if (clean) filters[k] = clean;
  }

  const overviewChart = raw.overviewChart && ctx.widgets.get(raw.overviewChart.widget)?.type === "table"
    ? raw.overviewChart
    : undefined;
  return {
    order, hidden, size, pinned, filters, extras, header: { compact: raw.header.compact },
    ...(raw.design !== undefined ? { design: raw.design } : {}),
    ...(overviewChart ? { overviewChart } : {}),
    baseVersion: raw.baseVersion,
  };
}
