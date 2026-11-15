import type { AlertListData, Cited, StatusGridData, TableData, TimelineData } from "@/lib/spec";

export type TransportReport = Cited & {
  id: string; name: string; status: string; connection?: boolean; fields: { label: string; value: string }[];
};
export type TransportGroup = { id: string; name: string; reports: TransportReport[] };
export type TransportSection = { label: string; groups: TransportGroup[] };
export type TransportNotice = AlertListData["items"][number];
export const reportTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
const meaningful = (value: string) => !!value && !/^(unknown|not (reported|specified|available)|n\/a)$/i.test(value.trim());

// Only normalize operator suffixes, not route numbers, branches, locations or combined operators.
export function operatorKey(name: string) {
  return name.toLowerCase().trim().replace(/\s+air\s*lines?$/i, "").replace(/\s+/g, " ");
}
function groupsOf(reports: TransportReport[], operators: boolean): TransportGroup[] {
  const groups = new Map<string, TransportGroup>();
  for (const report of reports) {
    const key = operators ? operatorKey(report.name) : report.name.toLowerCase().trim();
    const id = `${operators ? "operator" : "place"}:${key}`;
    const group = groups.get(id) ?? { id, name: report.name, reports: [] };
    group.reports.push(report);
    groups.set(id, group);
  }
  return [...groups.values()].map(group => ({ ...group,
    reports: [...group.reports].sort((a, b) => reportTime(b.asOf) - reportTime(a.asOf)),
  })).sort((a, b) => Number(!!a.reports[0].connection) - Number(!!b.reports[0].connection)
    || reportTime(b.reports[0].asOf) - reportTime(a.reports[0].asOf));
}

export function transportSections(tables: { title: string; data: TableData }[], services: StatusGridData["items"] = []): TransportSection[] {
  const places: TransportReport[] = [], operators: TransportReport[] = [];
  let airport = false, airline = false;
  for (const { data } of tables) {
    const operator = data.columns.find(c => /\b(airline|operator|carrier|provider|agency)\b/i.test(`${c.key} ${c.label}`));
    const place = data.columns.find(c => /\b(airport|station|hub|port|route|line|corridor|terminal|region|location)\b/i.test(`${c.key} ${c.label}`));
    const identity = operator ?? place;
    if (!identity) continue;
    const state = data.columns.find(c => c !== identity && (c.kind === "status" || /status|condition|state/i.test(`${c.key} ${c.label}`)));
    if (!state) continue;
    airport ||= !!place && /airport/i.test(`${place.key} ${place.label}`);
    airline ||= !!operator && /airline/i.test(`${operator.key} ${operator.label}`);
    for (const row of data.rows) {
      const name = row.cells[identity.key];
      if (!meaningful(name)) continue;
      (operator ? operators : places).push({ ...row, name,
        connection: !operator && /region/i.test(`${identity.key} ${identity.label}`),
        status: row.cells[state.key] || "Status not reported",
        fields: data.columns.filter(c => c !== identity && c !== state && c.kind !== "link")
          .map(c => ({ label: c.label, value: row.cells[c.key] ?? "" })).filter(f => meaningful(f.value)),
      });
    }
  }
  if (!operators.length) for (const service of services) operators.push({ ...service,
    status: { operational: "Reported operational", degraded: "Disrupted", down: "Unavailable", unknown: "Status unconfirmed" }[service.state],
    fields: service.note ? [{ label: "Service report", value: service.note }] : [],
  });
  return [
    { label: airport ? "Airports & connections" : "Locations & routes", groups: groupsOf(places, false) },
    { label: airline ? "Airlines & travel options" : "Operators & services", groups: groupsOf(operators, true) },
  ];
}

export function noticeKind(notice: TransportNotice) {
  if (!notice.active) return "Inactive";
  if (/\b(possible|possibly|expected|forecast|planned|could|may)\b/i.test(`${notice.title} ${notice.text}`)) return "Forecast";
  if (/\b(lifted|ended|removed|reopened)\b/i.test(notice.title)) return "Lifting notice";
  if (notice.level === "info") return "Guidance";
  return "Advisory";
}
export function transportNotices(items: TransportNotice[]) {
  const groups = new Map<string, TransportNotice>();
  for (const item of [...items].sort((a, b) => reportTime(b.asOf) - reportTime(a.asOf))) {
    const key = `${item.issuer.replace(/^U\.S\.\s*/i, "").toLowerCase()}|${item.text.toLowerCase().trim()}|${item.active}`;
    const previous = groups.get(key);
    if (previous) groups.set(key, { ...previous, sources: [...new Set([...previous.sources, ...item.sources])] });
    else groups.set(key, { ...item });
  }
  return [...groups.values()];
}
export function networkMilestone(timeline?: TimelineData) {
  return [...(timeline?.items ?? [])].filter(item =>
    /nationwide|systemwide|network|airspace/i.test(item.title)
    && /\b(lifts?|lifted|reopens?|reopened|resumes?|resumed|restores?|restored|closes?|closed|suspends?|suspended)\b/i.test(item.title)
    && !/\b(not|never|expected|expects|planned|possible|could|may)\b/i.test(item.title)
    && reportTime(item.at) > -Infinity,
  ).sort((a, b) => reportTime(b.at) - reportTime(a.at))[0];
}

export function recoveryForecast(timeline?: TimelineData) {
  return [...(timeline?.items ?? [])].filter(item =>
    /\b(expect|expects|expected|forecast|estimate|estimated|predict|predicts)\b/i.test(item.title)
    && /normal|recover|restor|reopen|resum/i.test(item.title),
  ).sort((a, b) => reportTime(b.at) - reportTime(a.at))[0];
}

export function statusTone(status: string): "neutral" | "warning" | "success" {
  if (/possible|planned|expected|unknown|unconfirmed|not reported|waiver|advisory|alert/i.test(status)) return "neutral";
  if (/partial|disrupt|delay|cancel|closed|closure|suspend|recover|unavailable/i.test(status)) return "warning";
  if (/operational|normal|restored|reopened/i.test(status)) return "success";
  return "neutral";
}
