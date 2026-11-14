import {
  emptyLayout,
  widgetKeyOf,
  type BoardData,
  type BoardSpecV2,
  type ExtraWidget,
  type PersonalLayout,
  type StatGridData,
  type TrendData,
  type Widget,
  type WidgetData,
  type WidgetFilter,
  type WidgetKey,
} from "@/lib/spec";

/** Widgets that close a board. A baseline widget with nothing before it is slotted in ahead of these. */
const TAIL = new Set(["feed", "changelog", "sources"]);

export type LaidOutWidget = {
  key: WidgetKey;
  widget: Widget;
  /** Set for extras, which have no stored data: built from the stat-grid item's history. */
  data?: WidgetData;
  filter?: WidgetFilter;
  pinned: boolean;
  /** Added to the baseline after the layout was last saved. */
  isNew: boolean;
  extra?: ExtraWidget;
};

export type AppliedLayout = { widgets: LaidOutWidget[]; compactHeader: boolean };

/** The trend data an extra draws, from the stat-grid item for its metric. Null when the metric is gone. */
export function extraTrendData(data: BoardData | null, spec: BoardSpecV2, metric: string): TrendData | null {
  const grid = spec.widgets.find((w) => w.type === "stat-grid");
  const items = grid ? (data?.widgets[grid.id] as StatGridData | undefined)?.items : undefined;
  const item = items?.find((i) => i.key === metric);
  if (!item) return null;
  return {
    metric,
    label: item.label,
    unit: item.unit,
    points: (item.history ?? []).map((h) => ({ t: h.t, v: h.v, sources: item.sources })),
  };
}

/**
 * Applies a person's layout to the latest baseline (spec section 4.4). Pure. `spec` holds the widgets to draw, already
 * filtered to the ones that have something to show. `version` is the baseline version on screen; widgets the layout has
 * never placed get a New badge when the layout was saved against an older version.
 */
export function applyLayout(spec: BoardSpecV2, data: BoardData | null, layout: PersonalLayout | null, opts: { version?: number } = {}): AppliedLayout {
  const l = layout ?? emptyLayout();
  const base = spec.widgets.map((w) => ({ key: widgetKeyOf(w), widget: w }));
  const byKey = new Map(base.map((b) => [b.key, b]));
  const hidden = new Set(l.hidden);

  const extras = new Map<WidgetKey, { extra: ExtraWidget; data: TrendData }>();
  for (const e of l.extras) {
    if (byKey.has(e.key) || extras.has(e.key) || hidden.has(e.key)) continue;
    const d = extraTrendData(data, spec, e.metric);
    if (d) extras.set(e.key, { extra: e, data: d });
  }
  const known = (k: WidgetKey) => (byKey.has(k) || extras.has(k)) && !hidden.has(k);

  const placed = new Set<WidgetKey>();
  const pinned: WidgetKey[] = [];
  for (const k of l.pinned) {
    if (known(k) && !placed.has(k)) {
      pinned.push(k);
      placed.add(k);
    }
  }
  const rest: WidgetKey[] = [];
  for (const k of l.order) {
    if (known(k) && !placed.has(k)) {
      rest.push(k);
      placed.add(k);
    }
  }

  // Baseline widgets the layout does not place go right after their nearest placed baseline predecessor.
  base.forEach((b, i) => {
    if (placed.has(b.key) || hidden.has(b.key)) return;
    placed.add(b.key);
    // feed, changelog and sources close the board unless the person moved them.
    if (TAIL.has(b.widget.type)) return void rest.push(b.key);
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = rest.indexOf(base[j].key);
    if (at >= 0) rest.splice(at + 1, 0, b.key);
    else {
      const tail = rest.findIndex((k) => TAIL.has(byKey.get(k)?.widget.type ?? ""));
      if (tail >= 0) rest.splice(tail, 0, b.key);
      else rest.push(b.key);
    }
  });

  // Extras without a place go right after the stat grid, or ahead of the tail.
  for (const k of extras.keys()) {
    if (placed.has(k)) continue;
    const grid = rest.findIndex((x) => byKey.get(x)?.widget.type === "stat-grid");
    const tail = rest.findIndex((x) => TAIL.has(byKey.get(x)?.widget.type ?? ""));
    const at = grid >= 0 ? grid + 1 : tail >= 0 ? tail : rest.length;
    rest.splice(at, 0, k);
    placed.add(k);
  }

  const seenByLayout = new Set([...l.order, ...l.pinned, ...l.hidden]);
  const fresh = layout !== null && opts.version !== undefined && l.baseVersion < opts.version;
  const out = (k: WidgetKey, isPinned: boolean): LaidOutWidget => {
    const size = l.size[k];
    const ex = extras.get(k);
    if (ex) {
      const w: Widget = { id: `x-${k}`, key: k, type: "trend", title: ex.extra.title, span: size ?? "half", bind: ex.extra.metric, metrics: [] };
      return { key: k, widget: w, data: ex.data, pinned: isPinned, isNew: false, extra: ex.extra };
    }
    const b = byKey.get(k)!;
    const widget = size && size !== b.widget.span ? { ...b.widget, span: size } : b.widget;
    const f = l.filters[k];
    return {
      key: k,
      widget,
      filter: f && f.kind === b.widget.type ? f : undefined,
      pinned: isPinned,
      isNew: fresh && !seenByLayout.has(k),
    };
  };
  return { widgets: [...pinned.map((k) => out(k, true)), ...rest.map((k) => out(k, false))], compactHeader: !!l.header?.compact };
}

/**
 * The layout to save after the person changed something. `order` lists every baseline widget (and extra) in display
 * order except pinned ones, so a widget the baseline adds later is recognisable as new, and baseVersion moves to the
 * version on screen. `spec` is the full baseline spec, not only the widgets with data.
 */
export function settleLayout(spec: BoardSpecV2, data: BoardData | null, next: PersonalLayout, version: number): PersonalLayout {
  const applied = applyLayout(spec, data, next);
  const order = applied.widgets.filter((w) => !w.pinned).map((w) => w.key);
  return { ...next, order, baseVersion: Math.max(next.baseVersion, version) };
}

/** Moves a key one step up or down among the widgets on screen. Returns the new order (pinned widgets stay put). */
export function moveKey(applied: AppliedLayout, key: WidgetKey, dir: -1 | 1): WidgetKey[] {
  const order = applied.widgets.filter((w) => !w.pinned).map((w) => w.key);
  const i = order.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  [order[i], order[j]] = [order[j], order[i]];
  return order;
}
