import type { Evidence, MapData, Source, TableData, TimelineData } from "@/lib/spec";
import { toMs } from "@/lib/time";
import type { IconName } from "@/components/ui/icon";

const dayMs = 86_400_000;
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const houthiSeries = [
  { key: "interceptions", label: "Interceptions", color: "var(--sw-chart-1)", icon: "check" },
  { key: "strikes", label: "Strike reports", color: "var(--sw-chart-2)", icon: "alert" },
  { key: "infrastructure", label: "Infrastructure", color: "var(--sw-chart-3)", icon: "layers" },
  { key: "maritime", label: "Maritime", color: "var(--sw-chart-4)", icon: "activity" },
  { key: "other", label: "Other developments", color: "var(--sw-chart-5)", icon: "note" },
] as const satisfies readonly { key: string; label: string; color: string; icon: IconName }[];

type Kind = (typeof houthiSeries)[number]["key"];

type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  approximate: boolean;
};

type Report = {
  id: string;
  title: string;
  detail: string;
  status?: string;
  at: string | null;
  time: number | null;
  kind: Kind;
  highPriority: boolean;
  places: Place[];
  sources: string[];
  evidence?: Evidence;
};

type ReplayDay = { day: number; reports: Report[] };
type Counts = Record<Kind, number>;
type ActivityBucket = Counts & { date: string };

const reportedPlaces: { name: string; pattern: RegExp; lat: number; lon: number }[] = [
  { name: "Riyadh", pattern: /\briyadh\b/i, lat: 24.71, lon: 46.67 },
  { name: "Eastern Province", pattern: /\beastern province\b/i, lat: 25.45, lon: 49.65 },
  { name: "Mecca area", pattern: /\b(mecca|makkah|sabouha)\b/i, lat: 21.42, lon: 39.83 },
  { name: "Medina area", pattern: /\b(medina|madinah)\b/i, lat: 24.47, lon: 39.61 },
  { name: "Yanbu", pattern: /\byanbu\b/i, lat: 24.09, lon: 38.06 },
  { name: "Jeddah", pattern: /\bjeddah\b/i, lat: 21.54, lon: 39.17 },
  { name: "Abqaiq", pattern: /\b(abqaiq|buqayq)\b/i, lat: 25.94, lon: 49.67 },
  { name: "Ras Tanura", pattern: /\bras tanura\b/i, lat: 26.64, lon: 50.16 },
  { name: "Jazan", pattern: /\b(jazan|jizan)\b/i, lat: 16.89, lon: 42.56 },
  { name: "Abha", pattern: /\babha\b/i, lat: 18.22, lon: 42.51 },
  { name: "Najran", pattern: /\bnajran\b/i, lat: 17.49, lon: 44.13 },
  { name: "Sana’a", pattern: /\bsan(?:a['’\s]?a|aa)\b/i, lat: 15.37, lon: 44.19 },
  { name: "Hodeida", pattern: /\b(?:al[- ]?)?(hodeidah?|hudaydah?|hodeyda)\b/i, lat: 14.80, lon: 42.95 },
  { name: "Taiz", pattern: /\bta(?:['’]izz?|izz?)\b/i, lat: 13.58, lon: 44.02 },
  { name: "Saada", pattern: /\bsa['’]?ada[h]?\b/i, lat: 16.94, lon: 43.76 },
  { name: "Aden", pattern: /\b(?<!gulf of )aden\b/i, lat: 12.80, lon: 45.03 },
  { name: "Bab el-Mandeb", pattern: /\bbab[ -]+(?:el|al)[ -]*mand[ae]b\b/i, lat: 12.60, lon: 43.34 },
  { name: "Gulf of Aden", pattern: /\bgulf of aden\b/i, lat: 12.16, lon: 48.12 },
  { name: "Sea of Oman", pattern: /\b(?:sea|gulf) of oman\b/i, lat: 24.65, lon: 57.40 },
  { name: "Strait of Hormuz", pattern: /\bstrait of hormuz\b/i, lat: 26.57, lon: 56.25 },
  { name: "Fujairah", pattern: /\bfujairah\b/i, lat: 25.13, lon: 56.33 },
];

export const houthiCategory = (kind: Kind) => houthiSeries.find(({ key }) => key === kind)!;
export const houthiDay = (time: number) => Math.floor(time / dayMs) * dayMs;
export const formatHouthiDay = (time: number) => dayFormat.format(time);

function reportKind(text: string): Kind {
  if (/\b(intercept\w*|shot down|downed|air defen[cs]e)\b/i.test(text)) return "interceptions";
  if (/\b(pipeline|pumping station|aramco|refiner(?:y|ies)|oil (?:field|facility|facilities|infrastructure|company)|gas facilit(?:y|ies)|energy sites?|export terminal)\b/i.test(text)) return "infrastructure";
  if (/\b(vessels?|maritime|ships?|shipping|aspides|tankers?|seafarers?|piracy|bab[ -]+(?:el|al)[ -]*mand[ae]b|sea of oman)\b/i.test(text)) return "maritime";
  if (/\b(strikes?|airstrikes?|attacks?|missiles?|drones?|debris|shelling|bombing|damaged?|explosions?)\b/i.test(text)) return "strikes";
  return "other";
}

function placeReferences(text: string): Place[] {
  return reportedPlaces.flatMap(({ name, pattern, lat, lon }) => pattern.test(text)
    ? [{ id: name, name, lat, lon, approximate: true }]
    : []);
}

function knownCitations(ids: string[] | undefined, evidence: Evidence | undefined, sources: Map<string, Source>) {
  return [...new Set([...(ids ?? []), ...(evidence ? [evidence.source] : [])])].filter((id) => sources.has(id));
}

function dateOfCell(value: string) {
  const date = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return toMs(date);
  if (/^[A-Za-z]+ \d{1,2},? \d{4}$/.test(date) || /^\d{1,2} [A-Za-z]+ \d{4}$/.test(date)) return toMs(date + " UTC");
  return null;
}

function parseTable(strikes: TableData | undefined, sources: Map<string, Source>): Report[] {
  if (!strikes) return [];
  const column = (pattern: RegExp) => strikes.columns.find(({ key, label }) => pattern.test(key) || pattern.test(label))?.key;
  const locationKey = column(/^(location|place|area)$/i);
  const targetKey = column(/^(event.target|event|target|incident|description)$/i);
  const dateKey = column(/^(incident.date|event.date|date|time)$/i);
  const statusKey = column(/^(status|outcome)$/i);
  return strikes.rows.flatMap(({ id, cells, evidence, sources: ids }) => {
    const citations = knownCitations(ids, evidence, sources);
    const title = targetKey ? cells[targetKey]?.trim() : "";
    const location = locationKey ? cells[locationKey]?.trim() : "";
    const date = dateKey ? cells[dateKey]?.trim() : "";
    const status = statusKey ? cells[statusKey]?.trim() : undefined;
    if (!title || !citations.length) return [];
    const time = date ? dateOfCell(date) : null;
    const places = placeReferences(location || title);
    return [{ id: `table:${id}`, title, detail: location || "", status, time, places, highPriority: false,
      at: time === null ? null : new Date(time).toISOString().slice(0, 10),
      kind: reportKind([status, title].filter(Boolean).join(" ")), sources: citations, evidence }];
  });
}

function parseTimeline(timeline: TimelineData | undefined, sources: Map<string, Source>): Report[] {
  return (timeline?.items ?? []).flatMap(({ id, title, at, detail, evidence, importance, sources: ids }) => {
    const citations = knownCitations(ids, evidence, sources);
    if (!title?.trim() || !citations.length) return [];
    const namedPlaces = placeReferences(title);
    return [{ id: `event:${id}`, title, at, detail, time: toMs(at), kind: reportKind(title),
      places: namedPlaces.length ? namedPlaces : placeReferences(detail ?? ""),
      highPriority: importance === "high", sources: citations, evidence }];
  });
}

function parseMap(map: MapData | undefined, sources: Map<string, Source>): Report[] {
  return (map?.points ?? []).flatMap(({ id, name, lat, lon, note, asOf, evidence, sources: ids }) => {
    const citations = knownCitations(ids, evidence, sources);
    if (!name?.trim() || !citations.length || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 85 || Math.abs(lon) > 180) return [];
    const namedPlaces = placeReferences(name);
    const placeId = namedPlaces.length === 1 ? namedPlaces[0].id : `map:${id}`;
    return [{ id: `map:${id}`, title: name, detail: note, at: asOf, time: toMs(asOf), kind: reportKind(note || name),
      places: [{ id: placeId, name, lat, lon, approximate: false }], highPriority: false, sources: citations, evidence }];
  });
}

export function buildHouthiReplay(timeline: TimelineData | undefined, strikes: TableData | undefined,
  map: MapData | undefined, sources: Map<string, Source>) {
  const events = parseTimeline(timeline, sources);
  const rows = parseTable(strikes, sources);
  const mapEntries = parseMap(map, sources);
  // A report can be included in both widgets. Use the timeline for the count when it has dated events.
  const activity = events.some(({ time }) => time !== null) ? events : rows;
  const days = new Map<number, Report[]>();
  for (const report of activity) {
    if (report.time === null) continue;
    const day = houthiDay(report.time);
    const reports = days.get(day);
    if (reports) reports.push(report);
    else days.set(day, [report]);
  }
  const frames = [...days].sort(([a], [b]) => a - b).map(([day, reports]): ReplayDay => ({
    day,
    reports: reports.sort((a, b) => Number(b.highPriority) - Number(a.highPriority) ||
      Number(b.places.length > 0) - Number(a.places.length > 0) || (b.time ?? 0) - (a.time ?? 0)),
  }));
  const locationReports = [...rows, ...mapEntries, ...events].filter(({ places }) => places.length);
  return { frames, locationReports };
}

export function houthiMarkers(reports: Report[], day: number | undefined, highlightedId: string | undefined, atLatest: boolean) {
  const markers = new Map<string, { place: Place; report: Report }>();
  const through = day === undefined || atLatest ? Infinity : day + dayMs;
  const visible = reports.filter((report) => report.time === null ? atLatest : report.time < through);
  visible.sort((a, b) => (a.time ?? -Infinity) - (b.time ?? -Infinity));
  for (const report of visible) {
    for (const place of report.places) {
      if (highlightedId && markers.get(place.id)?.report.id === highlightedId) continue;
      markers.set(place.id, { place, report });
    }
  }
  return [...markers.values()];
}

function emptyCounts(): Counts {
  return { interceptions: 0, strikes: 0, infrastructure: 0, maritime: 0, other: 0 };
}

export function houthiActivity(frames: ReplayDay[], day: number) {
  const first = frames[0]?.day ?? day;
  const span = ((frames.at(-1)?.day ?? day) - first) / dayMs + 1;
  // Group longer windows into equal date intervals so silent periods remain visible.
  const step = Math.max(1, Math.ceil(span / 20)) * dayMs;
  const data: ActivityBucket[] = Array.from({ length: Math.ceil(span * dayMs / step) }, (_, index) => ({
    ...emptyCounts(),
    date: new Date(first + index * step).toISOString().slice(0, 10),
  }));
  const counts = emptyCounts();
  for (const frame of frames) {
    const bucket = data[Math.floor((frame.day - first) / step)];
    for (const { kind } of frame.reports) {
      bucket[kind] += 1;
      if (frame.day <= day) counts[kind] += 1;
    }
  }
  const breakdown = houthiSeries
    .map(({ key, label, color }) => ({ key, label, color, value: counts[key] }))
    .filter(({ value }) => value > 0);
  return { data, breakdown, interval: step / dayMs, total: breakdown.reduce((n, { value }) => n + value, 0) };
}
