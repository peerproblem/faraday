import type { BoardData, Evidence, NarrativeData, StatGridData, StatItem, TableData, TimelineData, Widget } from "@/lib/spec";
import { toMs } from "@/lib/time";

// What the general strike board shows, read from the board's own widgets. Every function returns nothing
// rather than a guess when the data it needs is missing, so a section disappears instead of showing a wrong figure.

type Cite = { sources: string[]; evidence?: Evidence };

function dataOf<T>(widgets: Widget[], data: BoardData | null, type: Widget["type"]): T[] {
  return widgets.flatMap((widget) => {
    const value = widget.type === type ? data?.widgets[widget.id] : undefined;
    return value ? [value as T] : [];
  });
}

export function strikeStats(widgets: Widget[], data: BoardData | null): StatItem[] {
  return dataOf<StatGridData>(widgets, data, "stat-grid").flatMap((grid) => grid.items ?? [])
    .filter((item) => item && typeof item.key === "string" && typeof item.valueText === "string");
}

function tableWith(widgets: Widget[], data: BoardData | null, column: RegExp) {
  return dataOf<TableData>(widgets, data, "table")
    .find((table) => table.columns?.some((c) => column.test(c.key)) && table.rows?.length);
}

const cell = (table: TableData, row: TableData["rows"][number], column: RegExp) => {
  const key = table.columns.find((c) => column.test(c.key))?.key;
  return (key && row.cells[key]?.trim()) || "";
};

const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** The figure in English digits. Reports quote it as written ("unas 120.000", "> 280"), which the board does not show. */
export function figureValue(item: StatItem): string {
  if (item.valueNum == null || !Number.isFinite(item.valueNum)) return item.valueText;
  const atLeast = /^\s*(?:>|≥|over|more than|at least|above|más de|al menos)/i.test(item.valueText) || /\+\s*$/.test(item.valueText);
  return `${number(item.valueNum)}${item.unit === "%" ? "%" : ""}${atLeast ? "+" : ""}`;
}

export type StrikeFigure = { key: string; label: string; value: string; item: StatItem };

const figureOrder: { key: RegExp; label: (item: StatItem) => string }[] = [
  // The count is one city's march when the sentence behind it names that city.
  { key: /attendance|protester|march/, label: (item) => /\bMadrid\b/.test(item.evidence?.quote ?? "") ? "Madrid march" : sentenceCase(item.label) },
  { key: /flights?-cancel/, label: () => "Flights cancelled" },
  { key: /trains?-cancel/, label: () => "Trains cancelled" },
  { key: /arrest|detain/, label: () => "Arrests" },
];

/** The headline counts, in a fixed order. Turnout is left out: it is a dispute, not one number. */
export function strikeFigures(items: StatItem[]): StrikeFigure[] {
  return figureOrder.flatMap(({ key, label }) => {
    const item = items.find((candidate) => key.test(candidate.key));
    return item ? [{ key: item.key, label: label(item), value: figureValue(item), item }] : [];
  });
}

/** Reported values without the stray report that is several times every other one (a different count under the same name). */
export function steadyHistory(history: StatItem["history"]): number[] {
  const points = (history ?? []).filter((p) => toMs(p.t) !== null && Number.isFinite(p.v)).sort((a, b) => toMs(a.t)! - toMs(b.t)!);
  const sorted = points.map((p) => p.v).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return points.map((p) => p.v).filter((v) => median <= 0 || v <= median * 5);
}

export type TurnoutClaim = Cite & { value: number; bound: "up to" | "under" | null };

const percent = /(\d+(?:[.,]\d+)?)\s*%/;

/** Both sides' own turnout figure: the unions' best sector and the employers' average. Null unless both are reported. */
export function turnoutClaims(widgets: Widget[], data: BoardData | null): { unions: TurnoutClaim; employers: TurnoutClaim } | null {
  const turnout = strikeStats(widgets, data).find((item) => /turnout|participation/.test(item.key));
  const reported = [
    ...(turnout?.conflict ?? []).map((c) => ({ text: c.valueText, sources: c.sources })),
    ...(turnout ? [{ text: turnout.valueText, sources: turnout.sources }] : []),
  ].flatMap(({ text, sources }) => {
    const value = Number(text.match(percent)?.[1]?.replace(",", "."));
    return Number.isFinite(value) && value <= 100 ? [{ value, sources }] : [];
  }).sort((a, b) => b.value - a.value);

  const table = tableWith(widgets, data, /^actor$/);
  const employers = table?.rows.flatMap((row) => {
    if (!/employ|ceoe|patronal|business/i.test(cell(table, row, /^actor$/))) return [];
    const match = cell(table, row, /position/).match(/(?:under|below|less than|<)\s*(\d+(?:[.,]\d+)?)\s*%/i);
    return match ? [{ value: Number(match[1].replace(",", ".")), bound: "under" as const, sources: row.sources ?? [], evidence: row.evidence }] : [];
  })[0];

  const top = reported[0];
  if (!top || !employers || top.value <= employers.value) return null;
  return { unions: { ...top, bound: "up to", evidence: turnout?.evidence }, employers };
}

/** The sentence of the summary that explains the turnout dispute, if there is one. */
export function turnoutSentence(widgets: Widget[], data: BoardData | null) {
  return dataOf<NarrativeData>(widgets, data, "narrative").flatMap((n) => n.sentences ?? [])
    .find((sentence) => /turnout/i.test(sentence?.text ?? "") && /employer/i.test(sentence.text));
}

export type CityMarch = Cite & { id: string; city: string; attendance: string | null; count: number | null; status: string; tone: "danger" | "warning" | "neutral" };

const places = (city: string) => city.split(/,|\band\b|&/i).map((part) => part.trim().toLowerCase()).filter(Boolean);

/** One row per city, largest march first. Rows without a count or a known outcome and repeats of a listed city are dropped. */
export function cityMarches(widgets: Widget[], data: BoardData | null): CityMarch[] {
  const table = tableWith(widgets, data, /^city$/);
  if (!table) return [];
  const seen = new Set<string>();
  const marches = table.rows.flatMap((row): CityMarch[] => {
    const city = cell(table, row, /^city$/);
    const status = cell(table, row, /status/);
    const raw = cell(table, row, /attendance/);
    const names = places(city);
    if (!city || names.every((name) => seen.has(name))) return [];
    const off = /suspend|cancel/i.test(`${status} ${raw}`);
    const count = Number(raw.match(/\d[\d,.]*/)?.[0]?.replace(/[,.](?=\d{3})/g, ""));
    const unknown = !raw || /^(?:not specified|unknown|unspecified|n\/a)$/i.test(raw);
    if (unknown && !off) return [];
    names.forEach((name) => seen.add(name));
    return [{
      id: row.id, city, status,
      attendance: off || unknown ? null : raw.split("(")[0].trim().replace(/[+,;]\s*$/, ""),
      count: off || !Number.isFinite(count) || count === 0 ? null : count,
      tone: off ? "warning" : /clash|charge|riot|violen|injur|arrest/i.test(status) ? "danger" : "neutral",
      sources: row.sources ?? [], evidence: row.evidence,
    }];
  });
  const rank = (march: CityMarch) => march.tone === "warning" ? 2 : march.count === null ? 1 : 0;
  return marches.sort((a, b) => rank(a) - rank(b) || (b.count ?? 0) - (a.count ?? 0));
}

export type ServiceLevel = { id: string; label: string; value: number };

const generic = /^(?:metro|trains?|flights?|buses|bus|rail)$/i;

/** Share of normal service each transport line ran, from rows that state one percentage. One row per line, newest report first. */
export function serviceLevels(widgets: Widget[], data: BoardData | null, limit = 7): ServiceLevel[] {
  const table = tableWith(widgets, data, /minimum-service/);
  if (!table) return [];
  const labels = new Set<string>();
  const values = new Set<number>();
  const levels: ServiceLevel[] = [];
  const rows = [...table.rows].sort((a, b) => (toMs(b.asOf) ?? -Infinity) - (toMs(a.asOf) ?? -Infinity));
  for (const row of rows) {
    const service = cell(table, row, /^service$/);
    const operator = cell(table, row, /operator/);
    const level = cell(table, row, /minimum-service/);
    const match = level.match(/^(?:around |about |~)?(\d+(?:\.\d+)?)\s*%/i);
    // "75% peak / 50% off-peak" and "18% to 85%" are not one level; "73% (65% medium-distance)" is.
    const more = level.slice(match?.[0].length ?? 0).replace(/\([^)]*\)/g, "");
    if (!match || percent.test(more) || /cancel/i.test(level) || !/metro|rail|train|flight|bus|air|freight|cercan|distancia|line/i.test(`${service} ${operator}`)) continue;
    const label = generic.test(service) && operator && !/not specified|unspecified/i.test(operator) ? operator : service;
    const value = Number(match[1]);
    const name = label.toLowerCase();
    if (labels.has(name) || values.has(value)) continue;
    labels.add(name);
    values.add(value);
    levels.push({ id: row.id, label, value });
    if (levels.length === limit) break;
  }
  return levels.sort((a, b) => b.value - a.value);
}

export type Stance = "for" | "against";
export type Actor = Cite & { id: string; name: string; stance: Stance; position: string };

// The same actor is reported under many names ("CEOE", "La patronal", "Business leaders"). Each line folds them into one.
const actors: { match: RegExp; name: string }[] = [
  { match: /inquilin|tenant/i, name: "Tenants' union (Sindicato de Inquilinas)" },
  { match: /d[ií]az|labou?r minister/i, name: "Labour Minister Yolanda Díaz" },
  { match: /ceoe|employer|patronal|business/i, name: "Employers (CEOE)" },
  { match: /feij[oó]o|popular party|\bPP\b/i, name: "Popular Party (Feijóo)" },
  { match: /\bvox\b|abascal/i, name: "Vox (Abascal)" },
  { match: /madrid regional|comunidad de madrid|community of madrid/i, name: "Madrid regional government" },
  { match: /s[aá]nchez|government|governing coalition|council of ministers/i, name: "Spanish government (Sánchez)" },
  { match: /cc\.?\s?oo|\bugt\b|\bcgt\b|\bcnt\b|union|organi[sz]er|activist/i, name: "Unions (CCOO, UGT, CGT, CNT)" },
];

function stanceOf(text: string): Stance | null {
  if (/oppos|failure|illegal|nonsense|mistake|not be legal|against the/i.test(text)) return "against";
  if (/support|encourag|just cause|success|celebrat|demand|organi[sz]|leading|led the|strik|protest|back /i.test(text)) return "for";
  return null;
}

/** Who backs the strike and who opposes it, one entry per actor with the newest reported position. */
export function strikeActors(widgets: Widget[], data: BoardData | null): Actor[] {
  const table = tableWith(widgets, data, /^actor$/);
  if (!table) return [];
  const byName = new Map<string, Actor & { votes: number }>();
  for (const row of table.rows) {
    const label = cell(table, row, /^actor$/);
    const position = cell(table, row, /position/);
    const stance = stanceOf(`${cell(table, row, /status/)} ${position}`);
    const name = actors.find((actor) => actor.match.test(label))?.name;
    if (!name || !stance || !position) continue;
    const known = byName.get(name);
    if (known) known.votes += stance === known.stance ? 1 : -1;
    else byName.set(name, { id: row.id, name, stance, position, sources: row.sources ?? [], evidence: row.evidence, votes: 1 });
  }
  // An actor reported on both sides more often than not is left out instead of placed on one.
  return [...byName.values()].filter((actor) => actor.votes > 0).map((actor): Actor => ({
    id: actor.id, name: actor.name, stance: actor.stance, position: actor.position, sources: actor.sources, evidence: actor.evidence,
  }));
}

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export type UpcomingVote = Cite & { date: string; title: string; detail: string };

/** The election the strike led to, when the timeline reports its date. */
export function upcomingVote(widgets: Widget[], data: BoardData | null): UpcomingVote | null {
  for (const item of dataOf<TimelineData>(widgets, data, "timeline").flatMap((timeline) => timeline.items ?? [])) {
    if (!/election/i.test(item?.title ?? "")) continue;
    const match = `${item.title} ${item.detail}`.match(new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2})\\b`, "i"));
    const reported = toMs(item.at);
    if (!match || reported === null) continue;
    const month = months.indexOf(match[1].toLowerCase());
    const year = new Date(reported).getUTCFullYear();
    // An election reported in December for "January 12" is next year's.
    const sameYear = Date.UTC(year, month, Number(match[2]));
    const date = new Date(sameYear < reported - 86_400_000 ? Date.UTC(year + 1, month, Number(match[2])) : sameYear);
    return { date: date.toISOString(), title: item.title, detail: item.detail, sources: item.sources ?? [], evidence: item.evidence };
  }
  return null;
}

export type StrikeHour = { hour: number; count: number; high: number; titles: string[] };

/** Events of the strike day by UTC hour. The day is the one with the most timed reports; date-only reports have no hour. */
export function strikeDay(timeline: TimelineData | undefined): { day: string; hours: StrikeHour[] } | null {
  const timed = (timeline?.items ?? []).flatMap((item) => {
    const ms = toMs(item?.at);
    if (ms === null || !/T\d{2}:\d{2}/.test(item.at!) || /T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)$/.test(item.at!)) return [];
    return [{ ms, item }];
  });
  const days = new Map<string, number>();
  for (const { ms } of timed) {
    const day = new Date(ms).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const day = [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (!day || (days.get(day) ?? 0) < 4) return null;
  const hours: StrikeHour[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, high: 0, titles: [] }));
  for (const { ms, item } of timed) {
    const at = new Date(ms);
    if (at.toISOString().slice(0, 10) !== day) continue;
    const slot = hours[at.getUTCHours()];
    slot.count += 1;
    if (item.importance === "high") slot.high += 1;
    slot.titles.push(item.title);
  }
  return { day, hours };
}
