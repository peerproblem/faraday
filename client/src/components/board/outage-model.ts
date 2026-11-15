import type { Cited, LinkListData, MapData, StatusGridData, TableData } from "@/lib/spec";
import { toMs } from "@/lib/time";

export const utilityKinds = [
  { key: "power", label: "Electricity", pattern: /electric|power|grid|outage/i },
  { key: "water", label: "Water", pattern: /water|sewage/i },
  { key: "heat", label: "Heating", pattern: /heat|gas supply/i },
  { key: "transport", label: "Transport", pattern: /transport|transit|metro|tram|trolley/i },
  { key: "communications", label: "Communications", pattern: /internet|telecom|mobile|broadband/i },
  { key: "lighting", label: "Street lighting", pattern: /streetlight|street light|outdoor light/i },
] as const;

/** Categories are summaries of reports, never counts of independent services or claims of citywide status. */
export function utilityGroups(services: StatusGridData["items"]) {
  return utilityKinds.map(kind => {
    const reports = services.filter(item => kind.pattern.test(item.name)
      && (kind.key !== "power" || !/transport|transit|lighting|streetlight/i.test(item.name)))
      .sort((a, b) => (toMs(b.asOf) ?? -Infinity) - (toMs(a.asOf) ?? -Infinity));
    return { ...kind, reports, latest: reports[0] };
  }).filter(group => group.reports.length);
}
export type AreaReport = Cited & { id: string; label: string; status: string; windows: string; scheduleDate: string; timezone: string; other: { label: string; value: string }[] };
export type NamedTable = { title: string; data: TableData };
export function areaReports(tables: NamedTable[]): AreaReport[] {
  return tables.flatMap(({ title, data }) => {
    if (!/outage|power|electric|utility|schedule|service status/i.test(title)) return [];
    const subject = data.columns.find(c => /district|region|area|location|zone|queue|group|neighbou?rhood/i.test(`${c.key} ${c.label}`));
    const status = data.columns.find(c => c.kind === "status" || /power.status|outage.status/i.test(c.key));
    if (!subject || !status) return [];
    const windows = data.columns.find(c => /window|schedule|period/i.test(`${c.key} ${c.label}`) && !/date|zone/i.test(c.key));
    const date = data.columns.find(c => /date|valid.on|valid.for/i.test(c.key));
    const zone = data.columns.find(c => /time.?zone/i.test(c.key));
    return data.rows.filter(r => r.cells[subject.key]).map(r => ({ ...r, id: `${title}:${r.id}`, label: r.cells[subject.key], status: r.cells[status.key] || "Not reported",
      windows: windows ? r.cells[windows.key] ?? "" : "", scheduleDate: date ? r.cells[date.key] ?? "" : "", timezone: zone ? r.cells[zone.key] ?? "" : "",
      other: data.columns.filter(c => ![subject, status, windows, date, zone].includes(c)).map(c => ({ label: c.label, value: r.cells[c.key] ?? "" })),
    }));
  }).sort((a, b) => (toMs(b.asOf) ?? -Infinity) - (toMs(a.asOf) ?? -Infinity));
}
/** Only explicit clock ranges. Gaps mean unreported, never guaranteed electricity. */
export function clockWindows(text: string) {
  const result: { start: number; end: number }[] = [];
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g)) {
    const [, h1, m1, h2, m2] = m.map(Number);
    if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59 || (h2 === 24 && m2 !== 0)) continue;
    const start = h1 * 60 + m1, end = h2 * 60 + m2;
    if (start === end) continue;
    if (end < start) result.push({ start, end: 1440 }, { start: 0, end });
    else result.push({ start, end });
  }
  return result;
}
export function mappedArea(label: string | undefined, map: MapData | undefined) {
  if (!label) return undefined;
  const key = label.trim().toLowerCase();
  // Do not match “Region - queue 1” to a city point, or a multi-district report to a single district.
  return map?.points.find(p => p.name.trim().toLowerCase() === key);
}
export function distinctResources(items: LinkListData["items"]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!/^https?:\/\//i.test(item.url)) return false;
    try {
      const url = new URL(item.url); const key = url.host.toLowerCase() + url.pathname.replace(/\/$/, "") + url.search;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    } catch { return false; }
  });
}
export const reportedAt = (value: string | null | undefined) => {
  const ms = toMs(value);
  return ms === null ? "Report time unknown" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(ms) + " UTC";
};
