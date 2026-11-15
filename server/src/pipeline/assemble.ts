// OWNER: F-PIPE-CORE. Pure functions: plan -> spec, facts -> data (guide P3-9).
import {
  accentFor,
  singleWidgetTypes,
  widgetKeyOf,
  widgetTypes,
  type AlertListData,
  type BoardData,
  type BoardSpecV2,
  type Cited,
  type Fact,
  type HeaderData,
  type LinkListData,
  type Location,
  type MapData,
  type MapPointKind,
  type NarrativeData,
  type Plan,
  type ResourceKind,
  type SituationStatus,
  type Source,
  type StatGridData,
  type StatItem,
  type StatusGridData,
  type TableData,
  type TimelineData,
  type TrendData,
  type Widget,
  type WidgetData,
  type WidgetType,
} from "../spec";
import { evidenceOf } from "./evidence";
import { CONFLICT_WINDOW_MS, dayOf, timeOf } from "./merge";
import { corroboratedBy, isSocialSource, trustedFacts } from "./trust";
import { numbersEqual } from "./verify";

const DEFAULT_TITLE: Record<WidgetType, string> = {
  "on-the-ground": "On the ground (unverified)",
  narrative: "Situation",
  "stat-grid": "Key figures",
  trend: "Trend",
  timeline: "Timeline",
  map: "Map",
  table: "Table",
  "status-grid": "Status",
  "alert-list": "Official advisories",
  "link-list": "Get help",
  feed: "Latest coverage",
  changelog: "What changed",
  sources: "Sources",
};

const DEFAULT_SPAN: Record<WidgetType, "full" | "half"> = {
  "on-the-ground": "full",
  narrative: "full",
  "stat-grid": "full",
  trend: "half",
  timeline: "half",
  map: "full",
  table: "full",
  "status-grid": "full",
  "alert-list": "half",
  "link-list": "half",
  feed: "half",
  changelog: "half",
  sources: "full",
};

/** Types that appear at most once on a board. table, status-grid and trend are unique per binding. */
const SINGLE = new Set<WidgetType>(singleWidgetTypes);
const TAIL: WidgetType[] = ["feed", "changelog", "sources"];

type Draft = Omit<Widget, "id" | "key">;

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const sigOf = (w: Draft) => (SINGLE.has(w.type) ? w.type : `${w.type}:${w.bind}`);

/** Validates the plan's widgets, gives them ids (w1, w2...), adds required ones (narrative, stat-grid, timeline,
 * map when located, alert-list, link-list, feed, changelog, sources) and drops bindings to unknown keys.
 * A plan does not carry layout settings, so each widget keeps the `display` it had in `prev` (matched by key). */
export function specFromPlan(plan: Plan, prev?: BoardSpecV2 | null): BoardSpecV2 {
  const metricKeys = plan.metrics.map((m) => m.key);
  const metricSet = new Set(metricKeys);
  const tableSet = new Set(plan.tables.map((t) => t.key));
  const groupSet = new Set(plan.statusGroups.map((g) => g.key));
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  const push = (w: Draft, at?: number) => {
    const sig = sigOf(w);
    if (seen.has(sig)) return;
    seen.add(sig);
    if (at === undefined) drafts.push(w);
    else drafts.splice(at, 0, w);
  };
  const make = (type: WidgetType, bind: string | null = null, metrics: string[] = [], title?: string | null, span?: string | null): Draft => ({
    type,
    title: title?.trim() || DEFAULT_TITLE[type],
    span: span === "full" || span === "half" ? span : DEFAULT_SPAN[type],
    bind,
    metrics,
  });

  for (const wp of plan.widgets ?? []) {
    if (!wp || !(widgetTypes as readonly string[]).includes(wp.type)) continue;
    switch (wp.type) {
      case "stat-grid": {
        const ms = uniq((wp.metrics ?? []).filter((k) => metricSet.has(k)));
        push(make("stat-grid", null, ms.length ? ms : metricKeys, wp.title, wp.span));
        break;
      }
      case "trend":
        if (wp.bind && metricSet.has(wp.bind)) push(make("trend", wp.bind, [], wp.title, wp.span));
        break;
      case "table":
        if (wp.bind && tableSet.has(wp.bind)) push(make("table", wp.bind, [], wp.title, wp.span));
        break;
      case "status-grid":
        if (wp.bind && groupSet.has(wp.bind)) push(make("status-grid", wp.bind, [], wp.title, wp.span));
        break;
      default:
        push(make(wp.type, null, [], wp.title, wp.span));
    }
  }

  const has = (type: WidgetType, bind: string | null = null) => seen.has(SINGLE.has(type) ? type : `${type}:${bind}`);
  const indexOf = (type: WidgetType) => drafts.findIndex((w) => w.type === type);

  if (!has("narrative")) push(make("narrative"), 0);
  if (!has("stat-grid") && metricKeys.length) push(make("stat-grid", null, metricKeys), indexOf("narrative") + 1);
  if (!has("map") && plan.location) {
    const after = Math.max(indexOf("stat-grid"), indexOf("narrative"));
    push(make("map"), after + 1);
  }
  for (const t of plan.tables) if (!has("table", t.key)) push(make("table", t.key, [], t.title));
  for (const g of plan.statusGroups) if (!has("status-grid", g.key)) push(make("status-grid", g.key, [], g.title));
  if (!has("timeline")) push(make("timeline"));
  if (!has("alert-list")) push(make("alert-list"));
  if (!has("link-list")) push(make("link-list"));
  for (const t of TAIL) if (!has(t)) push(make(t));

  const body = drafts.filter((w) => !TAIL.includes(w.type));
  const tail = TAIL.map((t) => drafts.find((w) => w.type === t)!).filter(Boolean);
  const displays = new Map((prev?.widgets ?? []).flatMap((w) => (w.display ? [[widgetKeyOf(w), w.display] as const] : [])));
  const widgets = [...body, ...tail].map((w, i) => {
    const display = displays.get(sigOf(w));
    return { id: `w${i + 1}`, key: sigOf(w), ...w, ...(display ? { display } : {}) };
  });
  return { version: 2, widgets, ...(prev?.template ? { template: prev.template } : {}) };
}

export type HeaderOverrides = {
  headline?: { text: string; sources: string[] } | null;
  narrative?: { text: string; sources: string[] }[];
  assessment?: { status: SituationStatus; statusP: Record<string, number>; severity: number; severityP: Record<string, number> };
  location?: Location | null;
};

// ---------- helpers ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function fmtNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, frac] = String(Math.abs(rounded)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (rounded < 0 ? "-" : "") + grouped + (frac ? `.${frac}` : "");
}

function fmtSince(prevT: number, curT: number): string {
  const p = new Date(prevT);
  const c = new Date(curT);
  if (p.toISOString().slice(0, 10) === c.toISOString().slice(0, 10)) return `${pad(p.getUTCHours())}:${pad(p.getUTCMinutes())} UTC`;
  return `${MONTHS[p.getUTCMonth()]} ${p.getUTCDate()}`;
}

const CRITICAL = /death|dead|died|kill|fatal|injur|wound|missing|casualt|victim|사망|부상|실종|사상/i;
const OK = /restor|contain|reopen|recover|rescued|resolved|back online|복구|진화|구조/i;
const WARNING = /evacu|displac|homeless|without|outage|offline|closed|closure|affected|hospital|shelter|damag|destroy|burn|flood|대피|이재민|정전|피해|폐쇄/i;

function toneFor(key: string, label: string, unit: string | null): StatItem["tone"] {
  const s = `${key} ${label} ${unit ?? ""}`;
  if (CRITICAL.test(s)) return "critical";
  if (OK.test(s)) return "ok";
  if (WARNING.test(s)) return "warning";
  return "info";
}

type RankCtx = { official: Set<string>; relevance: Map<string, number>; sources: Map<string, Source> };

function factRank(f: Fact, ctx: RankCtx): [number, number, number, number, number] {
  return [
    timeOf(f.asOf) ?? -Infinity,
    f.sourceIds.some((s) => ctx.official.has(s)) ? 1 : 0,
    Math.max(0, ...f.sourceIds.map((s) => ctx.relevance.get(s) ?? 0)),
    f.createdAt,
    f.id,
  ];
}
function cmpRank(a: Fact, b: Fact, ctx: RankCtx): number {
  const ra = factRank(a, ctx);
  const rb = factRank(b, ctx);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? 1 : -1;
  return 0;
}

/** Newest first, undated last, then newest row. */
function byAsOfDesc(a: Fact, b: Fact): number {
  const ta = timeOf(a.asOf);
  const tb = timeOf(b.asOf);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return b.createdAt - a.createdAt || b.id - a.id;
}

/** An item's citation: its sources, its time, and the verified sentence when it may be shown (see evidenceOf). */
function cited(f: Fact, sources: Map<string, Source>): Cited {
  const evidence = evidenceOf(f, sources);
  return { sources: [...f.sourceIds], asOf: f.asOf, ...(evidence ? { evidence } : {}) };
}

function metricItem(key: string, plan: Plan, active: Fact<"metric">[], history: Fact<"metric">[], ctx: RankCtx): StatItem | null {
  const cands = active.filter((f) => f.key === key);
  if (!cands.length) return null;
  const cur = [...cands].sort((a, b) => cmpRank(a, b, ctx)).at(-1)!;
  const spec = plan.metrics.find((m) => m.key === key);
  const p = cur.payload;
  const tCur = timeOf(cur.asOf);
  const conflicts = cands
    .filter((f) => f.id !== cur.id)
    .filter((f) => {
      const t = timeOf(f.asOf);
      const sameWindow = (t === null && tCur === null) || (t !== null && tCur !== null && dayOf(f.asOf) === dayOf(cur.asOf) && Math.abs(t - tCur) < CONFLICT_WINDOW_MS);
      if (!sameWindow) return false;
      if (f.valueNum !== null && cur.valueNum !== null) return !numbersEqual(f.valueNum, cur.valueNum);
      return f.payload.valueText.trim() !== p.valueText.trim();
    })
    .sort((a, b) => a.id - b.id)
    .map((f) => ({ valueText: f.payload.valueText, sources: [...f.sourceIds] }));

  const points = historyPoints(key, history);
  let delta: string | null = null;
  let deltaNum: number | null = null;
  if (tCur !== null && cur.valueNum !== null) {
    // Reports inside the conflict window are simultaneous, not an earlier state, so delta skips them.
    const prev = [...points]
      .reverse()
      .find((pt) => {
        const t = Date.parse(pt.t);
        return t < tCur && tCur - t >= CONFLICT_WINDOW_MS && !numbersEqual(pt.v, cur.valueNum!);
      });
    if (prev) {
      deltaNum = Math.round((cur.valueNum - prev.v) * 1e6) / 1e6;
      delta = `${deltaNum > 0 ? "+" : "-"}${fmtNumber(Math.abs(deltaNum))} since ${fmtSince(Date.parse(prev.t), tCur)}`;
    }
  }
  const label = spec?.label ?? key;
  const unit = spec?.unit ?? p.unit ?? null;
  return {
    key,
    label,
    valueText: p.valueText,
    valueNum: cur.valueNum ?? p.valueNum ?? null,
    unit,
    delta,
    deltaNum,
    tone: toneFor(key, label, unit),
    conflict: conflicts.length ? conflicts : null,
    history: points.map((pt) => ({ t: pt.t, v: pt.v })),
    ...cited(cur, ctx.sources),
  };
}

/** Dated, numeric points for a metric, oldest first, one per timestamp (the newest row wins). */
function historyPoints(key: string, history: Fact<"metric">[]): { t: string; v: number; sources: string[] }[] {
  const byT = new Map<number, Fact<"metric">>();
  for (const f of history) {
    if (f.key !== key || !f.verified || (f.status !== "active" && f.status !== "superseded")) continue;
    const t = timeOf(f.asOf);
    const v = f.valueNum ?? f.payload.valueNum;
    if (t === null || v === null || !Number.isFinite(v)) continue;
    const prev = byT.get(t);
    if (!prev || prev.id < f.id) byT.set(t, f);
  }
  return [...byT.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, f]) => ({ t: new Date(t).toISOString(), v: (f.valueNum ?? f.payload.valueNum)!, sources: [...f.sourceIds] }));
}

const MAP_KINDS = new Set<MapPointKind>(["impact", "incident", "shelter", "closure", "resource", "origin"]);
const RESOURCE_KINDS: ResourceKind[] = ["official", "shelter", "hotline", "donate", "volunteer", "info"];
const LEVEL_ORDER = { warning: 0, watch: 1, info: 2 } as const;
const STATE_ORDER = { down: 0, degraded: 1, unknown: 2, operational: 3 } as const;

function findPrevNarrative(prev: BoardData | null, widgetId: string | undefined): NarrativeData | null {
  if (!prev) return null;
  const direct = widgetId ? (prev.widgets[widgetId] as NarrativeData | undefined) : undefined;
  if (direct && Array.isArray(direct.sentences)) return direct;
  for (const id of Object.keys(prev.widgets).sort()) {
    const w = prev.widgets[id] as Partial<NarrativeData>;
    if (w && Array.isArray(w.sentences)) return w as NarrativeData;
  }
  return null;
}

/**
 * Fills every widget from active, verified facts. Keeps header fields and narrative from `prev` unless overridden.
 * Adds a trend widget for metrics with >= 3 points (deterministic ids). Computes delta and tone from history.
 * Marks widgets without data as hidden. Deterministic: same input, same output (pass `now`).
 */
export function assemble(input: {
  plan: Plan;
  spec: BoardSpecV2;
  facts: Fact[];
  metricHistory: Fact<"metric">[];
  sources: Source[];
  prev: BoardData | null;
  overrides: HeaderOverrides;
  now: number;
}): { spec: BoardSpecV2; data: BoardData } {
  const { plan, prev, overrides } = input;
  const allActive = input.facts.filter((f) => f.status === "active" && f.verified);
  const active = trustedFacts(allActive, input.sources);
  const confirming = active.filter((f) => f.sourceIds.some((id) => input.sources.some((s) =>
    s.id === id && !isSocialSource(s) && (s.sourceType === "official" || s.sourceType === "news"))));
  const untrusted = allActive.filter((f) => !active.includes(f) && !corroboratedBy(f, confirming));
  const socialIds = new Set(input.sources.filter(isSocialSource).map((s) => s.id));
  const safeCitations = (part: { text: string; sources: string[] }) =>
    !part.sources.some((id) => socialIds.has(id)) || part.sources.some((id) =>
      input.sources.some((s) => s.id === id && !isSocialSource(s) && (s.sourceType === "official" || s.sourceType === "news")));
  const of = <K extends Fact["kind"]>(kind: K) => active.filter((f) => f.kind === kind) as unknown as Fact<K>[];
  const ctx: RankCtx = {
    official: new Set(input.sources.filter((s) => s.sourceType === "official").map((s) => s.id)),
    relevance: new Map(input.sources.map((s) => [s.id, s.relevance ?? 0])),
    sources: new Map(input.sources.map((s) => [s.id, s])),
  };
  const metrics = of("metric");
  const historyFacts = new Map<number, Fact<"metric">>();
  for (const f of [...trustedFacts(input.metricHistory, input.sources), ...metrics]) historyFacts.set(f.id, f);
  const history = [...historyFacts.values()].sort((a, b) => a.id - b.id);

  // Auto trend widgets for metrics with enough points.
  const widgets: Widget[] = input.spec.widgets.map((w) => ({ ...w, metrics: [...w.metrics] }));
  if (untrusted.length && !widgets.some((w) => w.type === "on-the-ground")) {
    // Above the feed/changelog/sources tail, not below the source list.
    const tailAt = widgets.findIndex((w) => TAIL.includes(w.type));
    widgets.splice(tailAt < 0 ? widgets.length : tailAt, 0,
      { id: "on-the-ground", type: "on-the-ground", title: DEFAULT_TITLE["on-the-ground"], span: "full", bind: null, metrics: [] });
  }
  // The warning is fixed; a plan cannot rename an unverified signal into an authoritative widget.
  for (const w of widgets) if (w.type === "on-the-ground") w.title = DEFAULT_TITLE["on-the-ground"];
  const trendBound = new Set(widgets.filter((w) => w.type === "trend").map((w) => w.bind));
  const autoTrends: Widget[] = [];
  for (const m of plan.metrics) {
    if (trendBound.has(m.key)) continue;
    if (historyPoints(m.key, history).length >= 3) {
      autoTrends.push({ id: `trend-${m.key}`, type: "trend", title: `${m.label} over time`, span: "half", bind: m.key, metrics: [] });
    }
  }
  if (autoTrends.length) {
    let at = widgets.findIndex((w) => w.type === "stat-grid");
    if (at < 0) at = widgets.findIndex((w) => w.type === "narrative");
    at += 1;
    while (at < widgets.length && widgets[at].type === "trend") at += 1;
    widgets.splice(at, 0, ...autoTrends);
  }

  const location = overrides.location !== undefined ? overrides.location : (prev?.header.location ?? null);
  const narrativeWidget = widgets.find((w) => w.type === "narrative");
  let narrative: NarrativeData | null = overrides.narrative
    ? { sentences: overrides.narrative.map((s) => ({ text: s.text, sources: [...s.sources] })) }
    : findPrevNarrative(prev, narrativeWidget?.id);

  if (narrative) narrative = { sentences: narrative.sentences.filter(safeCitations) };

  const data: Record<string, WidgetData> = {};
  const hidden: string[] = [];
  const set = (w: Widget, d: WidgetData | null) => {
    if (d === null) hidden.push(w.id);
    else data[w.id] = d;
  };

  for (const w of widgets) {
    switch (w.type) {
      case "on-the-ground": {
        // English only: a post in another language is shown by its translation, and not at all until it has one.
        const items = [...untrusted].sort(byAsOfDesc).map((f) => ({ f, c: cited(f, ctx.sources) })).filter(({ c }) => c.evidence).slice(0, 20)
          .map(({ f, c }) => ({ id: `social-${f.id}`, quote: c.evidence!.quote, ...c }));
        set(w, items.length ? { items } : null);
        break;
      }
      case "narrative":
        set(w, narrative && narrative.sentences.length ? narrative : null);
        break;
      case "stat-grid": {
        const keys = w.metrics.length ? w.metrics : plan.metrics.map((m) => m.key);
        const items = keys.map((k) => metricItem(k, plan, metrics, history, ctx)).filter((x): x is StatItem => !!x);
        set(w, items.length ? ({ items } satisfies StatGridData) : null);
        break;
      }
      case "trend": {
        const key = w.bind ?? "";
        const spec = plan.metrics.find((m) => m.key === key);
        const points = historyPoints(key, history);
        set(w, points.length >= 2 ? ({ metric: key, label: spec?.label ?? key, unit: spec?.unit ?? null, points } satisfies TrendData) : null);
        break;
      }
      case "timeline": {
        const items = of("event")
          .sort(byAsOfDesc)
          .slice(0, 50)
          .map((f) => ({ id: `e${f.id}`, at: f.asOf, title: f.payload.title, detail: f.payload.detail ?? "", importance: f.payload.importance ?? "medium", ...cited(f, ctx.sources) }));
        set(w, items.length ? ({ items } satisfies TimelineData) : null);
        break;
      }
      case "map": {
        const points = of("place")
          .filter((f) => {
            const { lat, lon } = f.payload;
            return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
          })
          .sort((a, b) => a.id - b.id)
          .map((f) => ({
            id: `p${f.id}`,
            name: f.payload.name,
            lat: f.payload.lat as number,
            lon: f.payload.lon as number,
            kind: MAP_KINDS.has(f.payload.placeKind) ? f.payload.placeKind : ("incident" as MapPointKind),
            note: f.payload.note ?? "",
            ...cited(f, ctx.sources),
          }));
        set(w, points.length || location ? ({ center: location, points } satisfies MapData) : null);
        break;
      }
      case "table": {
        const t = plan.tables.find((x) => x.key === w.bind);
        if (!t) {
          set(w, null);
          break;
        }
        const rows = of("row")
          .filter((f) => f.payload.table === t.key || f.key.startsWith(`${t.key}:`))
          .sort((a, b) => byAsOfDesc(a, b) || a.key.localeCompare(b.key))
          .map((f) => ({
            id: `r${f.id}`,
            cells: Object.fromEntries(t.columns.map((c) => [c.key, String(f.payload.cells?.[c.key] ?? "")])),
            ...cited(f, ctx.sources),
          }));
        set(w, rows.length ? ({ columns: t.columns.map((c) => ({ ...c })), rows } satisfies TableData) : null);
        break;
      }
      case "status-grid": {
        const items = of("status")
          .filter((f) => f.payload.group === w.bind || f.key.startsWith(`${w.bind}:`))
          .sort((a, b) => STATE_ORDER[a.payload.state] - STATE_ORDER[b.payload.state] || a.payload.name.localeCompare(b.payload.name) || a.id - b.id)
          .map((f) => ({ id: `st${f.id}`, name: f.payload.name, state: f.payload.state, note: f.payload.note ?? "", ...cited(f, ctx.sources) }));
        set(w, items.length ? ({ items } satisfies StatusGridData) : null);
        break;
      }
      case "alert-list": {
        const items = of("advisory")
          .sort((a, b) => {
            const aa = a.payload.active === false ? 1 : 0;
            const bb = b.payload.active === false ? 1 : 0;
            return aa - bb || LEVEL_ORDER[a.payload.level] - LEVEL_ORDER[b.payload.level] || byAsOfDesc(a, b);
          })
          .map((f) => ({
            id: `a${f.id}`,
            issuer: f.payload.issuer ?? "",
            title: f.payload.title,
            text: f.payload.text ?? "",
            level: f.payload.level,
            url: f.payload.url ?? null,
            active: f.payload.active !== false,
            ...cited(f, ctx.sources),
          }));
        set(w, items.length ? ({ items } satisfies AlertListData) : null);
        break;
      }
      case "link-list": {
        const items = of("resource")
          .sort((a, b) => {
            const ka = RESOURCE_KINDS.indexOf(a.payload.resourceKind);
            const kb = RESOURCE_KINDS.indexOf(b.payload.resourceKind);
            return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb) || a.payload.label.localeCompare(b.payload.label) || a.id - b.id;
          })
          .map((f) => ({ id: `l${f.id}`, label: f.payload.label, url: f.payload.url, kind: f.payload.resourceKind, note: f.payload.note ?? "", sources: [...f.sourceIds] }));
        set(w, items.length ? ({ items } satisfies LinkListData) : null);
        break;
      }
      case "feed":
      case "changelog":
      case "sources":
        set(w, {});
        break;
    }
  }

  let asOf: string | null = null;
  let asOfT = -Infinity;
  for (const f of active) {
    const t = timeOf(f.asOf);
    if (t !== null && t > asOfT) {
      asOfT = t;
      asOf = f.asOf;
    }
  }

  const a = overrides.assessment;
  const header: HeaderData = {
    title: plan.title,
    subtitle: plan.subtitle ?? null,
    crisisType: plan.crisisType,
    accent: accentFor(plan.crisisType),
    headline: overrides.headline !== undefined ? overrides.headline : (prev?.header.headline ?? null),
    status: a ? a.status : (prev?.header.status ?? null),
    statusP: a ? { ...a.statusP } : (prev?.header.statusP ?? null),
    severity: a ? a.severity : (prev?.header.severity ?? null),
    severityP: a ? { ...a.severityP } : (prev?.header.severityP ?? null),
    location,
    asOf,
    language: plan.language,
  };

  if (header.headline && !safeCitations(header.headline)) header.headline = null;
  return {
    spec: { version: 2, widgets, ...(input.spec.template ? { template: input.spec.template } : {}) },
    data: { header, widgets: data, hidden, generatedAt: input.now },
  };
}

/** Widget ids whose data differs between two BoardData objects, plus whether the header changed. */
export function diffData(prev: BoardData | null, next: BoardData): { widgets: string[]; header: boolean; hidden: boolean } {
  if (!prev) return { widgets: Object.keys(next.widgets), header: true, hidden: next.hidden.length > 0 };
  const widgets = Object.keys(next.widgets).filter((id) => JSON.stringify(prev.widgets[id]) !== JSON.stringify(next.widgets[id]));
  const header = JSON.stringify(prev.header) !== JSON.stringify(next.header);
  const a = [...prev.hidden].sort();
  const b = [...next.hidden].sort();
  const hidden = a.length !== b.length || a.some((x, i) => x !== b[i]);
  return { widgets, header, hidden };
}

export type { HeaderData };
