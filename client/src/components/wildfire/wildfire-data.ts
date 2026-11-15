import { widgetKeyOf, type AlertListData, type BoardData, type BoardSpecV2, type Evidence, type StatGridData, type StatItem, type TableData, type TimelineData, type TrendData, type Widget } from "@/lib/spec";

type Cited = { sources: string[]; evidence?: Evidence };
type LogItem = TimelineData["items"][number];

const DAY = 86_400_000;

/** Reads a widget's data by its stable key, so the design does not depend on widget ids. */
function byKey<T>(spec: BoardSpecV2 | null, data: BoardData | null, key: string): T | undefined {
  const widget = spec?.widgets.find((w: Widget) => widgetKeyOf(w) === key);
  return widget ? (data?.widgets[widget.id] as T | undefined) : undefined;
}

/**
 * Times read the way the incident was reported: in its own time zone. Sources mix full timestamps, local wall
 * times without a zone and bare dates (often stored as midnight UTC), so each is read for what it says.
 */
export function incidentClock(timeZone: string) {
  const formatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  const offsetFormat = formatter({ timeZoneName: "longOffset" });
  const offsetAt = (ms: number) => {
    const name = offsetFormat.formatToParts(ms).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000 : 0;
  };
  const wall = (y: number, m: number, d: number, h = 0, min = 0) => {
    const guess = Date.UTC(y, m - 1, d, h, min);
    return guess - offsetAt(guess - offsetAt(guess));
  };
  const day = formatter({ year: "numeric", month: "2-digit", day: "2-digit" });
  const dayLabel = formatter({ weekday: "short", month: "short", day: "numeric" });
  const shortDay = formatter({ month: "short", day: "numeric" });
  const time = formatter({ hour: "numeric", minute: "2-digit" });
  const hour = formatter({ hour: "numeric" });
  const zone = formatter({ timeZoneName: "short" });

  /** Milliseconds, and whether the source gave only a date. Null when the text is not a time. */
  function parse(at: string | null | undefined): { ms: number; dateOnly: boolean } | null {
    if (!at) return null;
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at) ?? /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0+)?)?Z$/.exec(at);
    if (date) return { ms: wall(+date[1], +date[2], +date[3], 12), dateOnly: true };
    const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(at);
    if (local) return { ms: wall(+local[1], +local[2], +local[3], +local[4], +local[5]), dateOnly: false };
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? { ms, dateOnly: false } : null;
  }

  return {
    timeZone,
    parse,
    dayKey: (ms: number) => {
      const parts = Object.fromEntries(day.formatToParts(ms).map((p) => [p.type, p.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    },
    /** Start of the local day that holds this moment. */
    startOfDay: (ms: number) => {
      const parts = Object.fromEntries(day.formatToParts(ms).map((p) => [p.type, p.value]));
      return wall(+parts.year, +parts.month, +parts.day);
    },
    day: (ms: number) => dayLabel.format(ms),
    shortDay: (ms: number) => shortDay.format(ms),
    time: (ms: number) => time.format(ms),
    /** "1 PM", for chart axes. */
    hour: (ms: number) => hour.format(ms),
    zone: (ms: number) => zone.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "",
    /** "Oct 17, 6:00 PM" */
    moment: (ms: number) => `${shortDay.format(ms)}, ${time.format(ms)}`,
  };
}
export type IncidentClock = ReturnType<typeof incidentClock>;

export type SeriesPoint = Cited & { ms: number; v: number };
export type ZoneRelease = Cited & { ms: number | null; text: string; zones: string[] };
export type LogEntry = Cited & { id: string; ms: number | null; dateOnly: boolean; title: string; detail: string; key: boolean };
export type LogDay = { key: string; ms: number | null; day: number | null; entries: LogEntry[]; containment: number | null };
export type DayState = { ms: number; day: number; state: "orders" | "burning" | "contained"; containment: number | null };
export type Note = Cited & { id: string; title: string; text: string; ms: number | null };

export type WildfireView = {
  clock: IncidentClock;
  ignition: number | null;
  figures: Partial<Record<"containment" | "area" | "evacuated" | "destroyed" | "damaged" | "injuries", StatItem>>;
  containment: SeriesPoint[];
  growth: SeriesPoint[];
  ordersIssued: (Cited & { ms: number }) | null;
  releases: ZoneRelease[];
  homesThreatened: (Cited & { text: string }) | null;
  log: LogDay[];
  days: DayState[];
  restrictions: Note[];
  recovery: Note[];
};

function series(trend: TrendData | undefined, clock: IncidentClock): SeriesPoint[] {
  return (trend?.points ?? [])
    .flatMap((p) => {
      const t = clock.parse(p.t);
      return t && Number.isFinite(p.v) ? [{ ms: t.ms, v: p.v, sources: p.sources ?? [] }] : [];
    })
    .sort((a, b) => a.ms - b.ms);
}

function statItems(spec: BoardSpecV2 | null, data: BoardData | null) {
  return byKey<StatGridData>(spec, data, "stat-grid")?.items?.filter((item) => item && typeof item.key === "string") ?? [];
}

const figurePatterns = {
  containment: /contain/,
  area: /(burned|burn)-?area|acres/,
  evacuated: /evacuat/,
  destroyed: /destroyed/,
  damaged: /damaged/,
  injuries: /injur/,
} as const;

/** The board's fire, read from the widgets its plan bound for evacuations, containment, growth and damage. */
export function wildfireView(spec: BoardSpecV2 | null, data: BoardData | null, timeZone: string): WildfireView {
  const clock = incidentClock(timeZone);
  const items = statItems(spec, data);
  const figures: WildfireView["figures"] = {};
  for (const [name, pattern] of Object.entries(figurePatterns) as [keyof typeof figurePatterns, RegExp][]) {
    const item = items.find((i) => pattern.test(i.key));
    if (item) figures[name] = item;
  }

  const containment = series(byKey<TrendData>(spec, data, "trend:official-containment") ?? byKey<TrendData>(spec, data, "trend:containment"), clock);
  const growth = series(byKey<TrendData>(spec, data, "trend:first-day-fire-growth"), clock);
  const timeline = (byKey<TimelineData>(spec, data, "timeline")?.items ?? []).filter((item) => item && item.title);

  const parsedLog = timeline.map((item) => ({ item, t: clock.parse(item.at) }));
  const ignitionItem = parsedLog
    .filter(({ item, t }) => t && !t.dateOnly && /broke out|ignit|fire (?:started|began)/i.test(item.title))
    .sort((a, b) => a.t!.ms - b.t!.ms)[0];
  const ignition = ignitionItem?.t?.ms ?? growth[0]?.ms ?? containment[0]?.ms ?? null;

  const issued = parsedLog
    .filter(({ item, t }) => t && !t.dateOnly && /evacuation orders? (?:were |was )?issued/i.test(item.title))
    .sort((a, b) => a.t!.ms - b.t!.ms)[0];
  const ordersIssued = issued ? { ms: issued.t!.ms, sources: issued.item.sources ?? [], evidence: issued.item.evidence } : null;

  // Zones released together are one release: the same lift time in the official order history.
  const history = byKey<TableData>(spec, data, "table:evacuation-history");
  const zoneColumn = history?.columns.find((c) => /zone/i.test(c.key + c.label))?.key;
  const liftedColumn = history?.columns.find((c) => /lift/i.test(c.key + c.label))?.key;
  const releaseMap = new Map<string, ZoneRelease>();
  for (const row of history?.rows ?? []) {
    const zone = zoneColumn ? row.cells[zoneColumn]?.trim() : "";
    if (!zone) continue;
    const t = clock.parse(row.asOf);
    const ms = t && !t.dateOnly ? t.ms : null;
    const key = ms === null ? `text:${liftedColumn ? row.cells[liftedColumn] : ""}` : `ms:${ms}`;
    const release = releaseMap.get(key) ?? { ms, text: liftedColumn ? row.cells[liftedColumn] ?? "" : "", zones: [], sources: [], evidence: row.evidence };
    release.zones.push(zone);
    for (const id of row.sources ?? []) if (!release.sources.includes(id)) release.sources.push(id);
    releaseMap.set(key, release);
  }
  const releases = [...releaseMap.values()]
    .map((release) => ({ ...release, zones: release.zones.sort() }))
    .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));

  const impact = byKey<TableData>(spec, data, "table:community-impact");
  const measure = impact?.columns[0]?.key;
  const value = impact?.columns[1]?.key;
  const impactRow = (pattern: RegExp) => impact?.rows.find((row) => measure && pattern.test(row.cells[measure] ?? ""));
  const threatenedRow = impactRow(/homes threatened/i);
  const homesThreatened = threatenedRow && value
    ? { text: threatenedRow.cells[value] ?? "", sources: threatenedRow.sources ?? [], evidence: threatenedRow.evidence }
    : null;

  // The day containment reached its highest value by the end of each local day.
  const containedBy = (end: number) => {
    let v: number | null = null;
    for (const p of containment) if (p.ms < end) v = Math.max(v ?? 0, p.v);
    return v;
  };
  const dayNumber = (ms: number) => ignition === null ? null : Math.round((clock.startOfDay(ms) - clock.startOfDay(ignition)) / DAY) + 1;

  const entries: LogEntry[] = parsedLog.map(({ item, t }: { item: LogItem; t: ReturnType<IncidentClock["parse"]> }) => ({
    id: item.id,
    ms: t?.ms ?? null,
    dateOnly: t?.dateOnly ?? false,
    title: item.title,
    detail: item.detail,
    key: item.importance === "high",
    sources: item.sources ?? [],
    evidence: item.evidence,
  }));
  const groups = new Map<string, LogDay>();
  for (const entry of entries.sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity) || Number(b.dateOnly) - Number(a.dateOnly))) {
    const key = entry.ms === null ? "undated" : clock.dayKey(entry.ms);
    const group = groups.get(key) ?? {
      key,
      ms: entry.ms,
      day: entry.ms === null ? null : dayNumber(entry.ms),
      entries: [],
      containment: entry.ms === null ? null : containedBy(clock.startOfDay(entry.ms) + DAY),
    };
    group.entries.push(entry);
    groups.set(key, group);
  }

  const lastLift = releases.reduce<number | null>((max, r) => (r.ms !== null && (max === null || r.ms > max) ? r.ms : max), null);
  const fullyContained = containment.find((p) => p.v >= 100)?.ms ?? null;
  const days: DayState[] = [];
  if (ignition !== null) {
    const first = clock.startOfDay(ignition);
    const lastEvent = Math.max(...entries.map((e) => e.ms ?? -Infinity), fullyContained ?? -Infinity, ignition);
    for (let start = first, n = 1; start <= lastEvent && n <= 60; n++) {
      const end = start + DAY;
      const orders = ordersIssued !== null && lastLift !== null && ordersIssued.ms < end && lastLift >= start;
      const contained = fullyContained !== null && fullyContained < end;
      days.push({ ms: start + DAY / 2, day: n, state: orders ? "orders" : contained ? "contained" : "burning", containment: containedBy(end) });
      start = clock.startOfDay(end + DAY / 2);
    }
  }

  const alerts = byKey<AlertListData>(spec, data, "alert-list")?.items ?? [];
  const restrictions: Note[] = alerts
    .flatMap((alert) => {
      const t = clock.parse(alert.asOf);
      // Notices still in force after the last order was lifted are what people returning home need to know.
      if (!alert.active || !t || lastLift === null || t.ms <= lastLift) return [];
      return [{ id: alert.id, title: alert.title, text: alert.text, ms: t.ms, sources: alert.sources ?? [], evidence: alert.evidence }];
    });

  const recovery: Note[] = [];
  const planning = impactRow(/recovery|erosion|debris/i);
  if (planning && value) {
    recovery.push({ id: planning.id, title: planning.cells[measure!] ?? "Recovery", text: planning.cells[value] ?? "", ms: clock.parse(planning.asOf)?.ms ?? null, sources: planning.sources ?? [], evidence: planning.evidence });
  }
  for (const entry of entries) {
    if (/emergency|fema|federal/i.test(entry.title) && !/school/i.test(entry.title)) {
      recovery.push({ id: entry.id, title: entry.title, text: entry.detail, ms: entry.dateOnly ? null : entry.ms, sources: entry.sources, evidence: entry.evidence });
    }
  }
  const seen = new Set<string>();
  const uniqueRecovery = recovery.filter((note) => {
    const key = note.title.toLowerCase().replace(/[^a-z]+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    clock,
    ignition,
    figures,
    containment,
    growth,
    ordersIssued,
    releases,
    homesThreatened,
    log: [...groups.values()],
    days,
    restrictions,
    recovery: uniqueRecovery,
  };
}

/** Durations read in hours on the first day and in days after. */
export function formatSpan(ms: number) {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} min`;
  if (hours < 36) return `${Math.round(hours)} h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1).replace(/\.0$/, "") : Math.round(days)} d`;
}
