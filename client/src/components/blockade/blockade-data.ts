import type {
  AlertListData,
  BoardData,
  BoardSpecV2,
  Cited,
  Evidence,
  MapData,
  StatItem,
  TableData,
  TimelineData,
  Widget,
  WidgetType,
} from "@/lib/spec";
import { toMs } from "@/lib/time";

/** The board this page is designed for: "U.S. Blockade of Iran & Overland Trade Restrictions". */
export const BLOCKADE_BOARD_ID = "5odwdndtcazs";

const DAY = 86_400_000;

type Row = TableData["rows"][number];
type Advisory = AlertListData["items"][number];

/** A widget of the board with data to show. Picked by what it holds, so a rebuilt spec still lands in the right panel. */
function pick(spec: BoardSpecV2 | null, data: BoardData | null, type: WidgetType, title?: RegExp): Widget | undefined {
  const hidden = new Set(data?.hidden ?? []);
  const found = (spec?.widgets ?? []).filter((widget) => widget.type === type && !hidden.has(widget.id) && data?.widgets[widget.id]);
  return (title && found.find((widget) => title.test(widget.title))) || (title ? undefined : found[0]);
}

export function blockadeWidgets(spec: BoardSpecV2 | null, data: BoardData | null) {
  const tables = (spec?.widgets ?? []).filter((widget) => widget.type === "table");
  const crossings = pick(spec, data, "table", /cross|border|overland/i);
  const incidents = pick(spec, data, "table", /incident|interdict|maritime|vessel/i)
    ?? tables.find((widget) => widget !== crossings && data?.widgets[widget.id]);
  return {
    narrative: pick(spec, data, "narrative"),
    stats: pick(spec, data, "stat-grid"),
    interdictions: pick(spec, data, "trend", /interdict|vessel|turned|ship/i),
    map: pick(spec, data, "map"),
    crossings,
    incidents,
    timeline: pick(spec, data, "timeline"),
    advisories: pick(spec, data, "alert-list"),
    links: pick(spec, data, "link-list"),
    social: pick(spec, data, "on-the-ground"),
    // Filled in the browser from sources and events, so they never carry data of their own.
    changelog: spec?.widgets.find((widget) => widget.type === "changelog"),
    sources: spec?.widgets.find((widget) => widget.type === "sources"),
  };
}

// ── Maritime incidents ────────────────────────────────────────────────────

export type IncidentKind = "mine" | "enforcement" | "attack" | "stopped" | "other";

export const incidentKindLabel: Record<IncidentKind, string> = {
  mine: "Mine strikes",
  enforcement: "U.S. enforcement strikes",
  attack: "Missile, projectile and explosive attacks",
  stopped: "Turned back or stopped",
  other: "Other reports",
};

/** One categorical colour per kind, shared by the breakdown and the dot on each report. */
export const incidentKindColor: Record<IncidentKind, string> = {
  mine: "var(--sw-chart-6)",
  enforcement: "var(--sw-chart-1)",
  attack: "var(--sw-chart-4)",
  stopped: "var(--sw-chart-5)",
  other: "var(--sw-chart-8)",
};

export type Incident = Cited & {
  id: string;
  subject: string;
  action: string;
  status: string;
  at: number | null;
  /** The source's own wording of the time, kept for rows without a machine-readable one. */
  timeText: string;
  kind: IncidentKind;
  place: SeaPlace | null;
};

export function incidentKind(text: string): IncidentKind {
  if (/\bmines?\b/i.test(text)) return "mine";
  // Case matters: "US" the country, not "us" the pronoun.
  if (/(\bU\.?S\.?\b|American|CENTCOM)/.test(text) && /(struck|strike|disabled|targeted|fired|seized|boarded)/i.test(text)) return "enforcement";
  if (/(turned (?:back|away)|returned|stopped|warning shots|complied|diverted|intercepted)/i.test(text)) return "stopped";
  if (/(projectile|missile|explosive|drone|limpet|rocket|torpedo)/i.test(text)) return "attack";
  return "other";
}

type SeaPlace = { id: string; name: string; lat: number; lon: number };

/** Waters and landmarks the incident reports name. The first match wins, so specific places come before the strait. */
const seaPlaces: (SeaPlace & { match: RegExp })[] = [
  { id: "kharg", name: "Kharg Island", lat: 29.24, lon: 50.31, match: /kharg/i },
  { id: "lavan", name: "Lavan Island waters", lat: 26.55, lon: 53.36, match: /lavan/i },
  { id: "jask", name: "Jask", lat: 25.52, lon: 57.78, match: /\bjask\b/i },
  { id: "hormuz", name: "Strait of Hormuz", lat: 26.32, lon: 56.82, match: /hormuz|khasab|musandam|didamar|larak/i },
  { id: "gulf-of-oman", name: "Gulf of Oman", lat: 25.0, lon: 59.7, match: /gulf of oman|sea of oman|fujairah/i },
];

function columnsOf(table: TableData | undefined) {
  const columns = table?.columns ?? [];
  const text = columns.filter((column) => column.kind === "text");
  return {
    subject: text[0]?.key,
    detail: text[1]?.key,
    status: columns.find((column) => column.kind === "status")?.key,
    time: columns.find((column) => column.kind === "time")?.key,
  };
}

const cell = (row: Row, key: string | undefined) => (key ? row.cells?.[key]?.trim() ?? "" : "");

/** Incident reports, newest first. Reports without a readable time keep their order at the end. */
export function incidentsOf(table: TableData | undefined): Incident[] {
  const keys = columnsOf(table);
  const rows = (table?.rows ?? []).filter((row) => row && typeof row.id === "string" && cell(row, keys.subject));
  const incidents = rows.map((row): Incident => {
    const subject = cell(row, keys.subject);
    const action = cell(row, keys.detail);
    const timeText = cell(row, keys.time);
    const text = `${subject} ${action}`;
    return {
      id: row.id,
      subject,
      action,
      status: cell(row, keys.status),
      at: toMs(row.asOf) ?? toMs(timeText),
      timeText,
      kind: incidentKind(text),
      place: seaPlaces.find((place) => place.match.test(text)) ?? null,
      sources: row.sources ?? [],
      asOf: row.asOf,
      evidence: row.evidence,
    };
  });
  return incidents.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
}

export function incidentKinds(incidents: Incident[]) {
  const counts = new Map<IncidentKind, number>();
  for (const incident of incidents) counts.set(incident.kind, (counts.get(incident.kind) ?? 0) + 1);
  return [...counts].map(([kind, value]) => ({ id: kind, label: incidentKindLabel[kind], value }));
}

const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

/** One entry per UTC day, oldest first, ending on the day of `now`. */
export function incidentDays(incidents: Incident[], now: number, days = 30) {
  const end = dayStart(now);
  const counts = new Map<number, number>();
  for (const incident of incidents) {
    if (incident.at !== null) counts.set(dayStart(incident.at), (counts.get(dayStart(incident.at)) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = end - (days - 1 - index) * DAY;
    return { day, count: counts.get(day) ?? 0 };
  });
}

// ── Border crossings ──────────────────────────────────────────────────────

export type CrossingState = "closed" | "restricted" | "pending" | "open" | "unknown";

export const crossingStateLabel: Record<CrossingState, string> = {
  closed: "Closed",
  restricted: "Restricted",
  pending: "Closure expected",
  open: "Open",
  unknown: "Unclear",
};

export function crossingState(status: string): CrossingState {
  const text = status.toLowerCase();
  if (/(expected|planned|pending|set to|may )/.test(text)) return "pending";
  if (/(partial|intermittent|restrict|limited|quota|reduced|delay)/.test(text)) return "restricted";
  if (/(closed|shut|suspend|sealed|halt|blocked)/.test(text)) return "closed";
  if (/(open|normal|operat)/.test(text)) return "open";
  return "unknown";
}

type CrossingPlace = { id: string; name: string; neighbor: string; lat: number; lon: number };

/** Land crossings on the three borders the board follows, with the spellings the sources use. */
const crossingPlaces: (CrossingPlace & { match: RegExp })[] = [
  { id: "sheeb", name: "Al-Sheeb / Chazabeh", neighbor: "Iraq", lat: 31.86, lon: 47.79, match: /she+b\b|shayeb|chaz+abeh/i },
  { id: "mandali", name: "Mandali / Sumar", neighbor: "Iraq", lat: 33.79, lon: 45.7, match: /mandali|\bs[ou]+mar\b/i },
  { id: "shalamcheh", name: "Shalamcheh", neighbor: "Iraq", lat: 30.52, lon: 48.03, match: /shalamche/i },
  { id: "mehran", name: "Mehran / Zurbatiyah", neighbor: "Iraq", lat: 33.12, lon: 46.08, match: /mehran|zurbati/i },
  { id: "khosravi", name: "Khosravi / Muntheriya", neighbor: "Iraq", lat: 34.39, lon: 45.47, match: /khosravi|munth?[ei]ri/i },
  { id: "bashmaq", name: "Bashmaq", neighbor: "Iraq", lat: 35.6, lon: 46.0, match: /bashma[qkh]/i },
  { id: "haji-omeran", name: "Haji Omeran / Tamarchin", neighbor: "Iraq", lat: 36.67, lon: 45.05, match: /haji om|tamarchin/i },
  { id: "taftan", name: "Taftan / Mirjaveh", neighbor: "Pakistan", lat: 28.97, lon: 61.58, match: /taftan|mirjaveh/i },
  { id: "gabd", name: "Gabd / Rimdan", neighbor: "Pakistan", lat: 25.21, lon: 61.62, match: /gabd|rimdan/i },
  { id: "pishin", name: "Mand / Pishin", neighbor: "Pakistan", lat: 26.08, lon: 61.75, match: /pishin|\bmand\b/i },
  { id: "bazargan", name: "Bazargan / Gürbulak", neighbor: "Turkey", lat: 39.39, lon: 44.39, match: /bazargan|g[uü]rbulak/i },
  { id: "razi", name: "Razi / Kapıköy", neighbor: "Turkey", lat: 38.49, lon: 44.36, match: /\brazi\b|kap[ıi]k[oö]y/i },
  { id: "sero", name: "Sero / Esendere", neighbor: "Turkey", lat: 37.72, lon: 44.63, match: /\bsero\b|esendere/i },
];

const neighbors: [string, RegExp][] = [
  ["Iraq", /iraq|kurdistan|baghdad|maysan|basra|diyala/i],
  ["Pakistan", /pakistan|baloch/i],
  ["Turkey", /turk/i],
  ["Afghanistan", /afghan/i],
  ["Armenia", /armenia/i],
  ["Azerbaijan", /azerbaijan/i],
  ["Turkmenistan", /turkmen/i],
];

export type Crossing = Cited & {
  id: string;
  name: string;
  status: string;
  state: CrossingState;
  note: string;
  at: number | null;
  place: CrossingPlace | null;
};

export type NeighborBorder = {
  neighbor: string;
  /** The border as a whole, when the sources report on it. Newest first. */
  overall: Crossing[];
  /** Named crossings, one entry each. */
  crossings: Crossing[];
  state: CrossingState;
};

const stateWeight: Record<CrossingState, number> = { closed: 3, restricted: 2, pending: 1, open: 0, unknown: 0 };

/** How shut a border is on a 0 to 3 scale, for a Meter: open, closure expected, restricted, closed. */
export const stateLevel = (state: CrossingState) => stateWeight[state];

/**
 * Crossing reports grouped by neighbour. Several rows about the same named crossing become one entry (the newest
 * report, citing every source), and rows about a whole border sit apart from the named crossings.
 */
export function bordersOf(table: TableData | undefined): NeighborBorder[] {
  const keys = columnsOf(table);
  const byNeighbor = new Map<string, NeighborBorder>();
  const rows = (table?.rows ?? []).filter((row) => row && typeof row.id === "string" && cell(row, keys.subject));
  for (const row of rows) {
    const name = cell(row, keys.subject);
    const note = cell(row, keys.detail);
    const place = crossingPlaces.find((entry) => entry.match.test(name)) ?? null;
    const neighbor = place?.neighbor ?? neighbors.find(([, match]) => match.test(name))?.[0] ?? neighbors.find(([, match]) => match.test(note))?.[0] ?? "Other borders";
    const status = cell(row, keys.status);
    const crossing: Crossing = {
      id: row.id, name, status, state: crossingState(status), note, place,
      at: toMs(row.asOf), sources: row.sources ?? [], asOf: row.asOf, evidence: row.evidence,
    };
    let border = byNeighbor.get(neighbor);
    if (!border) byNeighbor.set(neighbor, border = { neighbor, overall: [], crossings: [], state: "unknown" });
    if (!place) {
      border.overall.push(crossing);
      continue;
    }
    const same = border.crossings.findIndex((entry) => entry.place?.id === place.id);
    if (same < 0) {
      border.crossings.push(crossing);
      continue;
    }
    // Keep the newest report and cite every source that reported on the crossing.
    const current = border.crossings[same];
    const newer = (crossing.at ?? -Infinity) > (current.at ?? -Infinity) ? crossing : current;
    border.crossings[same] = { ...newer, sources: [...new Set([...current.sources, ...crossing.sources])] };
  }
  const newestFirst = (a: Crossing, b: Crossing) => (b.at ?? -Infinity) - (a.at ?? -Infinity);
  return [...byNeighbor.values()].map((border) => {
    const overall = [...border.overall].sort(newestFirst);
    const crossings = [...border.crossings].sort((a, b) => stateWeight[b.state] - stateWeight[a.state] || newestFirst(a, b));
    // The newest report on the whole border says how it stands; without one, its most restricted crossing does.
    const state = overall[0]?.state ?? crossings[0]?.state ?? "unknown";
    return { neighbor: border.neighbor, overall, crossings, state };
  }).sort((a, b) => stateWeight[b.state] - stateWeight[a.state] || a.neighbor.localeCompare(b.neighbor));
}

// ── Advisories ────────────────────────────────────────────────────────────

const issuerSides: [string, RegExp][] = [
  ["United States", /(\bU\.?S\.?\b|United States|CENTCOM|NAVCENT|MARAD|Naval Forces Central)/],
  ["UKMTO and JMIC", /(ukmto|jmic|joint maritime|united kingdom)/i],
  ["Iran", /(iran|irgc)/i],
  ["Saudi Arabia", /saudi/i],
];

const sideColors: Record<string, string> = {
  "United States": "var(--sw-chart-1)",
  "UKMTO and JMIC": "var(--sw-chart-5)",
  Iran: "var(--sw-chart-3)",
  "Saudi Arabia": "var(--sw-chart-4)",
};

export const sideColor = (side: string) => sideColors[side] ?? "var(--sw-chart-8)";

export const issuerSide = (issuer: string) => issuerSides.find(([, match]) => match.test(issuer))?.[0] ?? "Other issuers";

export function advisorySides(items: Advisory[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.active) counts.set(issuerSide(item.issuer), (counts.get(issuerSide(item.issuer)) ?? 0) + 1);
  }
  return [...counts].map(([side, value]) => ({ id: side, label: side, value }));
}

// ── Map ───────────────────────────────────────────────────────────────────

export type MapLayer = "sea" | "land";
type Point = MapData["points"][number];
export type BlockadePoint = Point & { layer: MapLayer };

const short = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Places for the map: the points the board already located, one marker per water where incidents were reported
 * and one per named border crossing. The derived markers keep the sources of the reports behind them.
 */
export function mapPoints(located: Point[], incidents: Incident[], borders: NeighborBorder[]): BlockadePoint[] {
  const points: BlockadePoint[] = located.map((point) => ({ ...point, layer: "sea" }));
  const waters = new Map<string, Incident[]>();
  for (const incident of incidents) {
    if (incident.place) waters.set(incident.place.id, [...(waters.get(incident.place.id) ?? []), incident]);
  }
  for (const reports of waters.values()) {
    const [latest] = reports;
    const place = latest.place!;
    const count = `${reports.length} incident ${reports.length === 1 ? "report" : "reports"}`;
    const newest = latest.at !== null ? `, latest ${dayLabel(latest.at)}` : "";
    points.push({
      id: `sea:${place.id}`, name: place.name, lat: place.lat, lon: place.lon, kind: "impact", layer: "sea",
      note: short(`${count}${newest}. ${latest.subject}: ${latest.action}`),
      sources: [...new Set(reports.flatMap((report) => report.sources))].slice(0, 6),
      asOf: latest.asOf, evidence: latest.evidence,
    });
  }
  for (const border of borders) {
    for (const crossing of border.crossings) {
      const place = crossing.place!;
      points.push({
        id: `crossing:${place.id}`, name: `${place.name} (${place.neighbor})`, lat: place.lat, lon: place.lon, layer: "land",
        kind: crossing.state === "open" ? "resource" : "closure",
        note: short(`${crossing.status || crossingStateLabel[crossing.state]}. ${crossing.note}`),
        sources: crossing.sources, asOf: crossing.asOf, evidence: crossing.evidence,
      });
    }
  }
  return points;
}

/** The strait as an approximate area, drawn while an active advisory warns about it. */
export function hormuzArea(advisories: Advisory[]) {
  const warning = advisories.find((item) => item.active && item.level === "warning" && /hormuz/i.test(`${item.title} ${item.text}`));
  if (!warning) return null;
  return {
    id: "strait-of-hormuz",
    label: "Strait of Hormuz",
    tone: "danger" as const,
    boundary: "approximate" as const,
    description: short(`${warning.issuer}: ${warning.title}`),
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [55.95, 26.35], [55.95, 26.72], [56.45, 26.82], [56.95, 26.62], [57.05, 26.15],
        [56.75, 25.95], [56.55, 26.3], [56.4, 26.45], [55.95, 26.35],
      ]],
    },
  };
}

// ── Overview figures ──────────────────────────────────────────────────────

export type Figure = {
  key: string;
  label: string;
  value: string;
  caption?: string;
  history?: number[];
  sources?: string[];
  evidence?: Evidence;
};

const numberWords: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** A reported figure as the board states it. A lone number word ("one") is shown as its digit. */
export function figureOf(item: StatItem): Figure {
  const word = numberWords[item.valueText.trim().toLowerCase()];
  return {
    key: item.key,
    label: item.label,
    value: word === undefined ? item.valueText : String(word),
    caption: item.delta ?? undefined,
    history: item.history?.length > 1 ? item.history.map((point) => point.v) : undefined,
    sources: item.sources,
    evidence: item.evidence,
  };
}

/** The newest high-importance events, filled up with other recent ones. */
export function latestEvents(items: TimelineData["items"], count = 3) {
  const dated = items.filter((item) => item && item.title).sort((a, b) => (toMs(b.at) ?? -Infinity) - (toMs(a.at) ?? -Infinity));
  const high = dated.filter((item) => item.importance === "high").slice(0, count);
  const rest = dated.filter((item) => !high.includes(item)).slice(0, count - high.length);
  return [...high, ...rest].sort((a, b) => (toMs(b.at) ?? -Infinity) - (toMs(a.at) ?? -Infinity));
}
