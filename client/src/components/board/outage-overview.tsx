"use client";
import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CitationChip } from "@/components/ui/citation";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { SourceChips, OfficialReleasesContext } from "@/components/widgets/source-chips";
import { formatReportedMetric } from "@/components/widgets/metric-value";
import type { AlertListData, Cited, HeaderData, LinkListData, MapData, Source, StatItem, StatusGridData } from "@/lib/spec";
import { areaReports, clockWindows, distinctResources, mappedArea, reportedAt, utilityGroups, type AreaReport, type NamedTable } from "./outage-model";

const stateLabels = { operational: "Reported operational", degraded: "Disrupted", down: "Reported unavailable", unknown: "Unconfirmed" };
function Evidence({ item, sources }: { item: Cited; sources: Map<string, Source> }) {
  return <div className="fd-outage-evidence"><span>{reportedAt(item.asOf)}</span><OfficialReleasesContext.Provider value={[]}><SourceChips ids={item.sources} sources={sources} evidence={item.evidence} collapseAt={2} compactLabel /></OfficialReleasesContext.Provider></div>;
}
function Resource({ item }: { item: LinkListData["items"][number] }) {
  return <div className="fd-outage-resource"><span>{item.label}</span><CitationChip reference={item.kind === "official" ? "Official" : "Resource"} title={item.label} href={item.url} excerpt={item.note || undefined} /></div>;
}
function Schedule({ report }: { report: AreaReport }) {
  const windows = clockWindows(report.windows);
  const emergency = /emergency/i.test(report.status);
  return <div className="fd-outage-schedule">
    <div className="fd-outage-schedule-label"><strong>{emergency ? "Emergency outage report" : "Reported schedule"}</strong><Badge variant="neutral">{report.scheduleDate || "Validity unconfirmed"}</Badge></div>
    {windows.length ? <>
      <div className="fd-outage-day" role="img" aria-label={`Reported outage windows: ${report.windows}. Unmarked times are unconfirmed.`}>
        {windows.map((window, i) => <span key={i} style={{ left: `${window.start / 14.4}%`, width: `${(window.end - window.start) / 14.4}%` }} />)}
      </div>
      <div className="fd-outage-clock"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <p>{report.windows}</p><small>Amber: reported outage · grey: unconfirmed</small>
    </> : <p>{emergency ? "An emergency outage is reported; do not treat a published schedule as a restoration promise." : "No timed outage windows are available in this report."}</p>}
    <small>{report.timezone ? `Timezone: ${report.timezone}` : "Schedule timezone not stated"} · {report.scheduleDate ? "Check the operator for current applicability" : "Schedule date not stated"}</small>
  </div>;
}
export type OutageProps = {
  headline?: HeaderData["headline"]; metrics: StatItem[]; services: StatusGridData["items"]; tables: NamedTable[];
  resources: LinkListData["items"]; advisories: AlertListData["items"]; sources: Map<string, Source>; map?: MapData; checkedAt: string | null;
};
export function OutageOverview({ headline, metrics, services, tables, resources, sources, map, checkedAt, renderMap }: OutageProps & { renderMap: (data: MapData, focused: boolean) => ReactNode }) {
  const [selection, setSelection] = useState("all");
  const reports = areaReports(tables);
  const selected = reports.find(r => r.id === selection);
  const point = mappedArea(selected?.label, map);
  const groups = utilityGroups(services);
  const links = distinctResources(resources.filter(r => r.kind === "official" && /outage|shutdown|schedule|status|power|electric/i.test(r.label)));
  const support = distinctResources(resources.filter(r => /shelter|hotline/.test(r.kind)));
  const direct = links.filter(item => !/telegram|viber|chatbot|\bbot\b/i.test(item.label));
  const providers = (direct.length ? direct : links).filter((item, index, list) => list.findIndex(other => new URL(other.url).host === new URL(item.url).host) === index);
  const featured = [...providers.slice(0, 2), ...support.slice(0, 1)];
  return <div className="fd-outage-dashboard">
    <header className="fd-outage-heading"><div><span className="fd-outage-eyebrow">LOCAL IMPACT · REPORTED CONDITIONS</span><h2>Power & essential services</h2></div><small>Checked {reportedAt(checkedAt)}</small></header>
    <div className="fd-outage-metrics">{metrics.slice(0, 3).map(item => <Card key={item.key} padding="sm" radius="lg">
      <span className="fd-outage-muted">{item.label}</span><strong>{formatReportedMetric(item.valueText, item.unit).replace(/^more than ([\d,]+)/i, "$1+")}</strong>
      <Evidence item={item} sources={sources} />
    </Card>)}</div>
    <div className="fd-outage-middle">
      <Card padding="none" radius="lg" className="fd-outage-map-card">
        <div className="fd-outage-map-heading"><strong>Reported places</strong><small>Locations, not outage boundaries</small></div>
        <div className="fd-outage-map">{map ? renderMap(point ? { ...map, center: { name: point.name, lat: point.lat, lon: point.lon, zoom: 11 } } : map, !!point) : <p>No mapped locations in the collected reports.</p>}</div>
        <div className="fd-outage-map-caption">{selected ? point ? `Located: ${point.name}` : "This report has no exact map match · showing incident locations" : "Select an area report below to locate it where coordinates exist"}</div>
      </Card>
      <Card padding="sm" radius="lg" className="fd-outage-utilities"><header><h3>Essential services</h3><small>Across the incident · latest per category</small></header>
        {groups.slice(0, 4).map(g => <div className="fd-outage-utility" key={g.key}><div><strong>{g.label}</strong><Badge variant={g.latest.state === "operational" ? "success" : g.latest.state === "unknown" ? "neutral" : "warning"}>{new Set(g.reports.map(r => r.state)).size > 1 ? "Mixed reports" : stateLabels[g.latest.state]}</Badge></div><span className="fd-outage-muted">{g.latest.name}</span><Evidence item={g.latest} sources={sources} /></div>)}
        {!groups.length && <p>Service-specific reports are not available yet.</p>}
        
      </Card>
    </div>
    <div className="fd-outage-bottom">
      <Card padding="sm" radius="lg" className="fd-outage-area"><h3>What applies to your area?</h3>
        <Select aria-label="Area report" value={selected?.id ?? "all"} onValueChange={v => setSelection(v ?? "all")} size="sm"><SelectTrigger /><SelectContent><SelectItem value="all">Incident overview</SelectItem>{reports.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent></Select>
        {selected ? <><strong>{selected.status}</strong><Schedule report={selected} /><Evidence item={selected} sources={sources} /></> : <><p>{headline?.text ?? "Choose a reported area to inspect its service status and any published outage windows."}</p><small>{reports.length ? `${reports.length} area reports available. Address-level availability must be checked with the operator.` : "No area-level reports yet. Use the official resources for address-level information."}</small></>}
      </Card>
      <Card padding="sm" radius="lg" className="fd-outage-actions"><h3>Check your address & get help</h3><small>Official schedules and reported support resources</small>{featured.map(item => <Resource key={item.id} item={item} />)}{!featured.length && <p>No verified lookup or support links collected yet.</p>}<small>Full resource list and public guidance in Situation.</small></Card>
    </div>
  </div>;
}
export function OutageSituation({ headline, services, resources, advisories, sources }: OutageProps) {
  const groups = utilityGroups(services);
  const classified = new Set(groups.flatMap(g => g.reports.map(r => r.id)));
  const other = services.filter(s => !classified.has(s.id));
  const guidance = advisories.filter(a => a.active && a.sources.some(id => sources.get(id)?.sourceType === "official"));
  return <div className="fd-outage-situation">
    <h3>Service reports, by category</h3><p>{headline?.text}</p>{headline && <SourceChips ids={headline.sources} sources={sources} collapseAt={3} />}
    <p className="fd-outage-muted">Reported conditions, not live telemetry. Different areas and reporting times can have different states.</p>
    {[...groups, ...(other.length ? [{ key: "other", label: "Other services", reports: other, latest: other[0] }] : [])].map(g => <details key={g.key} className="fd-outage-report-group"><summary><strong>{g.label}</strong><span>{g.reports.length} {g.reports.length === 1 ? "report" : "reports"}</span></summary><ul>{g.reports.map(item => <li key={item.id}><strong>{item.name}</strong><Badge variant={item.state === "operational" ? "success" : item.state === "unknown" ? "neutral" : "warning"}>{stateLabels[item.state]}</Badge><p>{item.note}</p><Evidence item={item} sources={sources} /></li>)}</ul></details>)}
    <details className="fd-outage-report-group"><summary><strong>Official guidance</strong><span>{guidance.length}</span></summary>{guidance.map(a => <article key={a.id}><h4>{a.title}</h4><p>{a.text}</p><Evidence item={a} sources={sources} /></article>)}</details>
    <details className="fd-outage-report-group"><summary><strong>Lookup & support links</strong></summary>{distinctResources(resources).map(r => <Resource key={r.id} item={r} />)}</details>
    <p className="fd-outage-muted">Data retains every original table, figure and report. A report timestamp does not establish a schedule’s validity date.</p>
  </div>;
}
