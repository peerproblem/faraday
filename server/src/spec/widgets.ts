import { z } from "zod";
import type { Accent, CrisisType, Location, SituationStatus, SourceType } from "./common";

export const widgetTypes = [
  "narrative",
  "stat-grid",
  "trend",
  "timeline",
  "map",
  "table",
  "status-grid",
  "alert-list",
  "link-list",
  "on-the-ground",
  "feed",
  "changelog",
  "sources",
] as const;
export type WidgetType = (typeof widgetTypes)[number];

/**
 * One widget on a board. Flat on purpose (structured output handles flat objects best).
 * - stat-grid: `metrics` lists metric keys from the plan.
 * - trend: `bind` is one metric key.
 * - table: `bind` is a table key. status-grid: `bind` is a status group key.
 * - all others: `bind` is null and `metrics` is empty.
 */
export const widgetSchema = z.object({
  id: z.string(),
  /**
   * Stable identity across baseline versions (ids are positions and shift when widgets are added or removed).
   * The type for single widgets, `${type}:${bind}` for bound ones (table, status-grid, trend). Set by specFromPlan;
   * specs saved before keys existed lack it, so read it with widgetKeyOf.
   */
  key: z.string().optional(),
  type: z.enum(widgetTypes),
  title: z.string(),
  span: z.enum(["full", "half"]),
  bind: z.string().nullable(),
  metrics: z.array(z.string()),
});
export type Widget = z.infer<typeof widgetSchema>;

export type BoardSpecV2 = { version: 2; widgets: Widget[] };

/** Widget types that appear at most once on a board. table, status-grid and trend are unique per binding. */
export const singleWidgetTypes: readonly WidgetType[] = [
  "on-the-ground",
  "narrative",
  "stat-grid",
  "timeline",
  "map",
  "alert-list",
  "link-list",
  "feed",
  "changelog",
  "sources",
];

/** The stable key of a widget (see Widget.key), computed the same way for specs that predate keys. */
export function widgetKeyOf(w: Pick<Widget, "type" | "bind"> & { key?: string }): string {
  if (w.key) return w.key;
  return singleWidgetTypes.includes(w.type) ? w.type : `${w.type}:${w.bind}`;
}

export type Cited = { sources: string[]; asOf: string | null };

export type StatItem = Cited & {
  key: string;
  label: string;
  valueText: string;
  valueNum: number | null;
  unit: string | null;
  /** Human text such as "+3 since 09:00", computed in code from history. */
  delta: string | null;
  deltaNum: number | null;
  tone: "critical" | "warning" | "info" | "ok";
  /** Other values for the same metric at the same time from other sources. */
  conflict: { valueText: string; sources: string[] }[] | null;
  history: { t: string; v: number }[];
};

export type OnTheGroundData = { items: (Cited & { id: string; quote: string })[] };

export type NarrativeData = { sentences: { text: string; sources: string[] }[] };
export type StatGridData = { items: StatItem[] };
export type TrendData = { metric: string; label: string; unit: string | null; points: { t: string; v: number; sources: string[] }[] };
export type TimelineData = {
  items: (Cited & { id: string; at: string | null; title: string; detail: string; importance: "high" | "medium" | "low" })[];
};
export type MapPointKind = "impact" | "incident" | "shelter" | "closure" | "resource" | "origin";
export type MapData = {
  center: Location | null;
  points: (Cited & { id: string; name: string; lat: number; lon: number; kind: MapPointKind; note: string })[];
};
export type ColumnKind = "text" | "number" | "time" | "status" | "link";
export type TableData = {
  columns: { key: string; label: string; kind: ColumnKind }[];
  rows: (Cited & { id: string; cells: Record<string, string> })[];
};
export type ServiceState = "operational" | "degraded" | "down" | "unknown";
export type StatusGridData = { items: (Cited & { id: string; name: string; state: ServiceState; note: string })[] };
export type AlertListData = {
  items: (Cited & {
    id: string;
    issuer: string;
    title: string;
    text: string;
    level: "warning" | "watch" | "info";
    url: string | null;
    active: boolean;
  })[];
};
export type ResourceKind = "official" | "donate" | "shelter" | "hotline" | "volunteer" | "info";
export type LinkListData = { items: { id: string; label: string; url: string; kind: ResourceKind; note: string; sources: string[] }[] };
/** feed, changelog and sources are computed in the browser from sources and events. */
export type ClientComputedData = Record<string, never>;

export type WidgetDataMap = {
  "on-the-ground": OnTheGroundData;
  narrative: NarrativeData;
  "stat-grid": StatGridData;
  trend: TrendData;
  timeline: TimelineData;
  map: MapData;
  table: TableData;
  "status-grid": StatusGridData;
  "alert-list": AlertListData;
  "link-list": LinkListData;
  feed: ClientComputedData;
  changelog: ClientComputedData;
  sources: ClientComputedData;
};
export type WidgetData = WidgetDataMap[WidgetType];

export type HeaderData = {
  title: string;
  subtitle: string | null;
  crisisType: CrisisType;
  accent: Accent;
  headline: { text: string; sources: string[] } | null;
  status: SituationStatus | null;
  statusP: Record<string, number> | null;
  /** 1 to 5, may be fractional (probability-weighted). */
  severity: number | null;
  severityP: Record<string, number> | null;
  location: Location | null;
  /** Newest asOf across the board's facts. */
  asOf: string | null;
  language: string;
};

export type BoardData = {
  header: HeaderData;
  /** Keyed by widget id. A widget id missing here has no data yet. */
  widgets: Record<string, WidgetData>;
  /** Widget ids with nothing to show. The renderer skips them. */
  hidden: string[];
  generatedAt: number;
};

export type SourceTypeCounts = Partial<Record<SourceType, number>>;
