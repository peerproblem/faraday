// Turns a finance board's widgets into the shapes the finance page draws. Read-only: nothing here changes
// the board's data, it only regroups it (series that share a unit, dated table rows, one entry per company).
import type {
  AlertListData,
  BoardData,
  BoardSpecV2,
  Evidence,
  StatGridData,
  StatItem,
  TableData,
  TimelineData,
  TrendData,
  Widget,
  WidgetType,
} from "@/lib/spec";
import { toMs } from "@/lib/time";

export type Placed = { widget: Widget; data: unknown };

/** Widgets with data, in spec order. Hidden and empty widgets are skipped. */
export function placedWidgets(spec: BoardSpecV2 | null, data: BoardData | null): Placed[] {
  if (!spec || !data) return [];
  const hidden = new Set(data.hidden);
  return spec.widgets.filter((w) => !hidden.has(w.id) && data.widgets[w.id] !== undefined).map((w) => ({ widget: w, data: data.widgets[w.id] }));
}

export function ofType<T extends WidgetType>(placed: Placed[], type: T) {
  return placed.filter((p) => p.widget.type === type);
}

/* ── Figures and series ─────────────────────────────────────────────── */

export type SeriesPoint = { t: number; v: number; sources: string[] };
export type Series = { key: string; label: string; unit: string | null; points: SeriesPoint[]; latest: StatItem | null };

/** The latest value of every figure, in the order the boards' figure grids list them. */
export function figures(placed: Placed[]): StatItem[] {
  const seen = new Set<string>();
  return ofType(placed, "stat-grid").flatMap((p) => (p.data as StatGridData).items ?? []).filter((s) => !seen.has(s.key) && !!seen.add(s.key));
}

/**
 * Every metric reported at least twice. Trend charts carry a source per point, so their points win over the
 * figure grid's plain history for the same metric.
 */
export function metricSeries(placed: Placed[]): Series[] {
  const trends = new Map(ofType(placed, "trend").map((p) => [(p.data as TrendData).metric, p.data as TrendData]));
  const stats = figures(placed);
  const keys = [...new Set([...stats.map((s) => s.key), ...trends.keys()])];
  return keys.flatMap((key) => {
    const stat = stats.find((s) => s.key === key) ?? null;
    const trend = trends.get(key);
    const raw = trend && trend.points.length >= (stat?.history.length ?? 0)
      ? trend.points.map((p) => ({ t: toMs(p.t), v: p.v, sources: p.sources }))
      : (stat?.history ?? []).map((p) => ({ t: toMs(p.t), v: p.v, sources: [] as string[] }));
    const points = raw.filter((p): p is SeriesPoint => p.t !== null && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
    if (points.length < 2) return [];
    return [{ key, label: stat?.label ?? trend?.label ?? key, unit: stat?.unit ?? trend?.unit ?? null, points, latest: stat }];
  });
}

/** Series that can share one value axis, grouped by unit. The group with the most series comes first. */
export function unitGroups(series: Series[]): { unit: string; label: string; series: Series[] }[] {
  const groups = new Map<string, Series[]>();
  for (const s of series) groups.set(s.unit ?? "", [...(groups.get(s.unit ?? "") ?? []), s]);
  return [...groups].map(([unit, list]) => ({ unit, label: unitLabel(unit, list), series: list })).sort((a, b) => b.series.length - a.series.length);
}

function unitLabel(unit: string, list: Series[]): string {
  if (list.length === 1) return list[0].label;
  if (unit === "%") return "Change (%)";
  return unit || "Value";
}

/* ── Dated rows: lanes on the shared time axis ──────────────────────── */

export type LaneEvent = {
  id: string;
  t: number;
  title: string;
  detail: string;
  status: string | null;
  link: string | null;
  sources: string[];
  evidence?: Evidence;
};
export type Lane = { key: string; label: string; kind: "table" | "events"; events: LaneEvent[] };

/** Tables with a time column become lanes: one marker per dated row. */
export function tableLanes(placed: Placed[]): Lane[] {
  return ofType(placed, "table").flatMap((p) => {
    const table = p.data as TableData;
    const time = table.columns.find((c) => c.kind === "time");
    if (!time) return [];
    const texts = table.columns.filter((c) => c.kind === "text");
    const status = table.columns.find((c) => c.kind === "status");
    const link = table.columns.find((c) => c.kind === "link");
    const events = table.rows.flatMap((row) => {
      const t = toMs(row.cells[time.key] || row.asOf);
      if (t === null) return [];
      return [{
        id: row.id,
        t,
        title: row.cells[texts[0]?.key] ?? "",
        detail: row.cells[texts[1]?.key] ?? "",
        status: filled(status ? row.cells[status.key] : null),
        link: filled(link ? row.cells[link.key] : null),
        sources: row.sources,
        evidence: row.evidence,
      }];
    });
    return events.length ? [{ key: p.widget.id, label: p.widget.title, kind: "table" as const, events }] : [];
  });
}

/** The timeline's high-importance events, as a lane under the chart. */
export function keyEventLane(placed: Placed[]): Lane | null {
  const timeline = ofType(placed, "timeline")[0];
  if (!timeline) return null;
  const events = (timeline.data as TimelineData).items.flatMap((item) => {
    const t = item.importance === "high" ? toMs(item.at) : null;
    return t === null ? [] : [{ id: item.id, t, title: item.title, detail: item.detail, status: null, link: null, sources: item.sources, evidence: item.evidence }];
  });
  return events.length ? { key: "key-events", label: "Key events", kind: "events", events } : null;
}

export function activeAlerts(placed: Placed[]) {
  return ofType(placed, "alert-list").flatMap((p) => (p.data as AlertListData).items.filter((a) => a.active));
}

/* ── One entry per company: the ranking table ───────────────────────── */

const FILLER = /^(n\/?a|not (specified|reported|available|disclosed)|unknown|none|tbd|[-–—])$/i;

/** Null for blanks and placeholders such as "N/A" or "Not specified". */
export function filled(text: string | null | undefined): string | null {
  const t = text?.trim() ?? "";
  return t && !FILLER.test(t) ? t : null;
}

export function parseNumber(text: string | null | undefined): number | null {
  const t = filled(text);
  if (!t || !/\d/.test(t)) return null;
  const n = Number.parseFloat(t.replace(/,/g, "").replace(/^[^\d+-]+/, ""));
  return Number.isFinite(n) ? n : null;
}

export type RankReport = { rowId: string; text: string; value: number | null; sources: string[]; asOf: string | null; evidence?: Evidence; cells: Record<string, string> };
export type RankEntry = { key: string; name: string; ticker: string | null; value: number | null; reports: RankReport[]; lead: RankReport };
export type Ranking = {
  widget: Widget;
  table: TableData;
  value: { key: string; label: string };
  /** The column counts a fall (e.g. "Drop (%)"), so "17%" and "-17%" mean the same thing. */
  magnitude: boolean;
  entries: RankEntry[];
};

const SUFFIX = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "holdings", "group", "technology", "technologies", "platforms", "class", "the"]);
const normal = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !SUFFIX.has(w)).join(" ");

/** The first table without a time column that has a number column: companies ranked by that number. */
export function ranking(placed: Placed[]): Ranking | null {
  for (const p of ofType(placed, "table")) {
    const table = p.data as TableData;
    if (table.columns.some((c) => c.kind === "time")) continue;
    const value = table.columns.find((c) => c.kind === "number");
    const name = table.columns.find((c) => c.kind === "text" && !/ticker|symbol/i.test(c.label));
    if (!value || !name || !table.rows.length) continue;
    const ticker = table.columns.find((c) => /ticker|symbol/i.test(`${c.key} ${c.label}`));
    const magnitude = /drop|fall|declin|loss|lost|down/i.test(value.label);
    return { widget: p.widget, table, value: { key: value.key, label: value.label }, magnitude, entries: rankEntries(table, name.key, ticker?.key ?? null, value.key, magnitude) };
  }
  return null;
}

/**
 * Rows about the same company (same ticker, or the same name once "Inc." and the like are dropped) become one
 * entry. Its position is its newest report that has a number; the others stay listed with their sources.
 */
export function rankEntries(table: TableData, nameKey: string, tickerKey: string | null, valueKey: string, magnitude: boolean): RankEntry[] {
  const rows = table.rows.map((row) => {
    const value = parseNumber(row.cells[valueKey]);
    return {
      name: row.cells[nameKey]?.trim() ?? "",
      ticker: filled(tickerKey ? row.cells[tickerKey] : null)?.toUpperCase() ?? null,
      report: { rowId: row.id, text: row.cells[valueKey] ?? "", value: value === null ? null : magnitude ? Math.abs(value) : value, sources: row.sources, asOf: row.asOf, evidence: row.evidence, cells: row.cells },
    };
  }).filter((r) => r.name);
  const parent = rows.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const ids = rows.map((r) => [normal(r.name), r.ticker?.toLowerCase() ?? null] as const);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [ni, ti] = ids[i];
      const [nj, tj] = ids[j];
      if (ni === nj || (ti && (ti === tj || ti === nj)) || (tj && tj === ni)) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, typeof rows>();
  rows.forEach((r, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), r]));
  return [...groups.values()].map((group) => {
    const named = group.find((r) => r.ticker) ?? [...group].sort((a, b) => b.name.length - a.name.length)[0];
    const reports = group.map((r) => r.report).sort((a, b) => (toMs(b.asOf) ?? 0) - (toMs(a.asOf) ?? 0));
    const lead = reports.find((r) => r.value !== null) ?? reports[0];
    return { key: group[0].report.rowId, name: named.name, ticker: named.ticker, value: lead.value, reports, lead };
  }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}

/* ── Prices on a trading-time axis ──────────────────────────────────── */

const HOUR = 3_600_000;
const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The New York trading date of a moment, "2026-11-05". */
export const nyDay = (t: number) => NY_DAY.format(t);

/**
 * Maps time to a position where closed markets take little room: an hourly bar is one unit, a night 1.5, a
 * weekend or holiday 3. Time before the first bar gets up to 8 units. Marks (event times) that fall while the
 * market is closed, or after the last bar, are spaced evenly there instead, three units apart, so the news of a
 * weekend does not pile up on one spot.
 */
export function sessionAxis(bars: number[], from: number, to: number, marks: number[] = []): { pos: (t: number) => number; span: number } {
  if (!bars.length) return { pos: (t) => (t - from) / HOUR, span: Math.max(1, (to - from) / HOUR) };
  const times = [...new Set(marks)].sort((a, b) => a - b);
  const knots: [number, number][] = [];
  let u = 0;
  if (from < bars[0]) {
    knots.push([from, 0]);
    u = Math.min(8, (bars[0] - from) / HOUR);
  }
  knots.push([bars[0], u]);
  /** Closed time from a to b: its marks three units apart, then the rest of `room`. */
  const closed = (a: number, b: number, room: number) => {
    const inside = times.filter((t) => t > a && t < b);
    for (const t of inside) knots.push([t, (u += 3)]);
    u += Math.max(inside.length ? 1.5 : room, room - 3 * inside.length);
    knots.push([b, u]);
  };
  for (let i = 1; i < bars.length; i++) {
    const dt = bars[i] - bars[i - 1];
    if (dt <= 1.5 * HOUR) knots.push([bars[i], (u += dt / HOUR)]);
    else closed(bars[i - 1], bars[i], dt <= 30 * HOUR ? 1.5 : 3);
  }
  const last = bars[bars.length - 1];
  if (to > last) closed(last, to + 1, Math.min(8, (to - last) / HOUR));
  const pos = (t: number) => {
    if (t <= knots[0][0]) return knots[0][1];
    if (t >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];
    let lo = 0;
    let hi = knots.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (knots[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    const [t0, u0] = knots[lo];
    const [t1, u1] = knots[hi];
    return u0 + ((t - t0) / (t1 - t0)) * (u1 - u0);
  };
  return { pos, span: Math.max(1, u) };
}

/**
 * How a price moved around a moment: from the last close before it to the end of the first session that traded
 * after it. Null when there is no close before it, or nothing has traded since.
 */
export function reaction(points: [number, number][], t: number): { from: [number, number]; to: [number, number] } | null {
  const j = points.findIndex((p) => p[0] > t);
  if (j <= 0) return null;
  const day = nyDay(points[j][0]);
  let k = j;
  while (k + 1 < points.length && nyDay(points[k + 1][0]) === day) k++;
  return { from: points[j - 1], to: points[k] };
}
