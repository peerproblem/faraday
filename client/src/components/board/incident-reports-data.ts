import { incidentStatusTable, incidentTallyTable, officialBreakdown, officialCount, reportingTime, type BoardData, type Source, type TableData, type Widget } from "@/lib/spec";
import { STALE_MS } from "@/lib/time";

type Row = TableData["rows"][number];
type OfficialTally = {
  area: string;
  total: number;
  through: string;
  from?: string;
  issuer: string;
  url: string;
  breakdown?: { label: string; value: number }[];
};

export type ResponseIncident = { id: string; name: string; area: string; status: string; observedAt: string; until?: string; source: Source };

function getOfficialSource(row: Row, sources: Map<string, Source>) {
  const source = row.evidence ? sources.get(row.evidence.source) : undefined;
  if (!source || source.sourceType !== "official") return null;
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" ? source : null;
  } catch {
    return null;
  }
}

const areaKey = (area: string) => area.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function matchesReportingArea(area: string, areas: string[]) {
  if (!areas.length) return true;
  const name = ` ${areaKey(area)} `;
  return areas.some((candidate) => {
    const key = areaKey(candidate);
    return !!key && name.includes(` ${key} `);
  });
}

const activeStatus = /^(?:action required|active|open|in progress|response underway|evacuation in progress|closed to traffic|road closed|service suspended)$/i;

export function getIncidentReports({
  widgets, data, sources, areas, now,
}: {
  widgets: Widget[];
  data: BoardData | null;
  sources: Map<string, Source>;
  areas: string[];
  now: number | null;
}): { incidents: ResponseIncident[]; tallies: OfficialTally[] } {
  const tallies = new Map<string, OfficialTally>();
  const recentIncidents = new Map<string, ResponseIncident>();
  for (const widget of widgets) {
    if (widget.type !== "table" || (widget.bind !== incidentStatusTable && widget.bind !== incidentTallyTable)) continue;
    const table = data?.widgets[widget.id] as TableData | undefined;
    for (const row of table?.rows ?? []) {
      const source = getOfficialSource(row, sources);
      if (!source) continue;
      const cells = row.cells;
      const area = cells.region || cells.area || cells.country;
      if (!area || !matchesReportingArea(area, areas)) continue;
      if (widget.bind === incidentTallyTable) {
        const through = cells["reporting-window-end"];
        const cutoff = reportingTime(through);
        const count = officialCount(cells["total-incidents"]);
        if (cutoff === null || count === null || (now !== null && cutoff > now)) continue;
        const key = areaKey(area);
        const previous = tallies.get(key);
        if (!previous || cutoff > Date.parse(previous.through)) {
          const from = cells["reporting-window-start"];
          const start = reportingTime(from);
          tallies.set(key, {
            area, through, total: count,
            from: start !== null && start <= cutoff ? from : undefined,
            issuer: source.publisher ?? new URL(source.url).hostname, url: source.url,
            breakdown: officialBreakdown(cells.breakdown, count),
          });
        }
        continue;
      }

      const name = cells.incident;
      const observedAt = cells["status-as-of"];
      const observed = reportingTime(observedAt);
      if (!name || !cells.status || !observedAt || observed === null || now === null || observed > now) continue;
      const id = cells["incident-id"] || `${areaKey(area)}:${name.trim().toLowerCase()}`;
      const previous = recentIncidents.get(id);
      // A verified closure or resolution supersedes an earlier response even if it gives no expiry.
      if (previous && (observed < Date.parse(previous.observedAt) ||
        (observed === Date.parse(previous.observedAt) && !activeStatus.test(previous.status)))) continue;
      recentIncidents.set(id, {
        id, name, area, status: cells.status.trim(), observedAt,
        until: cells["valid-until"], source,
      });
    }
  }

  const incidents: ResponseIncident[] = [];
  if (now !== null) {
    for (const record of recentIncidents.values()) {
      const expires = reportingTime(record.until);
      const inForce = expires !== null && expires > now;
      // The board's stale-data window also applies to explicitly timestamped status snapshots.
      const recentSnapshot = !record.until && now - Date.parse(record.observedAt) <= STALE_MS;
      if ((inForce || recentSnapshot) && activeStatus.test(record.status)) incidents.push(record);
    }
  }
  return {
    incidents: incidents.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)),
    tallies: [...tallies.values()].sort((a, b) => Date.parse(b.through) - Date.parse(a.through)),
  };
}
