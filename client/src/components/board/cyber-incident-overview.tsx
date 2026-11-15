"use client";

import { Icon } from "@/components/ui/icon";
import { Card } from "@/components/ui/card";
import { CitationChip } from "@/components/ui/citation";
import { Badge } from "@/components/ui/badge";
import { CyberTrend } from "@/components/widgets/cyber-trend";
import { selectCyberTrend } from "./select-cyber-trend";
import { formatReportedMetric } from "@/components/widgets/metric-value";
import { evidenceUrl, OfficialReleasesContext, SourceChips } from "@/components/widgets/source-chips";
import { hostOf } from "@/lib/source-brand";
import type { AlertListData, Cited, HeaderData, LinkListData, ServiceState, Source, StatItem, StatusGridData, TableData, TimelineData, TrendData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import { primaryService, recoveryMetrics, resourceFor, scopeReports, userAdvisory } from "./cyber-user-summary";

const states: Record<ServiceState, string> = {
  operational: "Operational", degraded: "Partial disruption", down: "Service unavailable", unknown: "Status unconfirmed",
};
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Evidence({ item, sources, compact = false }: { item: Cited; sources: Map<string, Source>; compact?: boolean }) {
  const ids = item.sources.filter(id => sources.has(id));
  const date = toMs(item.asOf);
  return <div className="fd-cyber-evidence">
    {date !== null && <time dateTime={item.asOf ?? undefined} title={when(item.asOf)}>Reported {day.format(date)}</time>}
    <OfficialReleasesContext.Provider value={[]}>
    {compact ? <SourceChips ids={ids} sources={sources} evidence={item.evidence} collapseAt={2} compactLabel /> : <>
    <SourceChips ids={ids.slice(0, 2)} sources={sources} evidence={item.evidence} />
    {ids.length > 2 && <SourceChips ids={ids.slice(2)} sources={sources} evidence={item.evidence} collapseAt={1} compactLabel />}
    </>}
    </OfficialReleasesContext.Provider>
  </div>;
}

/** Same source-preview interaction as the rest of the board; never invent a source ID. */
function ResourceChip({ resource, sources }: { resource?: LinkListData["items"][number]; sources: Map<string, Source> }) {
  if (!resource) return null;
  const source = [...sources.values()].find(item => evidenceUrl(item.url) === evidenceUrl(resource.url));
  return <div className="fd-cyber-resource">
    <span>{resource.label}</span>
    <OfficialReleasesContext.Provider value={[]}>
      {source ? <SourceChips ids={[source.id]} sources={sources} /> :
        <CitationChip reference="Official" title={resource.label} href={resource.url}
          publisher={hostOf(resource.url) ?? "Official resource"} excerpt={resource.note || undefined} />}
    </OfficialReleasesContext.Provider>
  </div>;
}

function Metric({ item, label, sources, compact = false }: { item?: StatItem; label: string; sources: Map<string, Source>; compact?: boolean }) {
  const value = item ? formatReportedMetric(item.valueText, item.unit) : "Not reported";
  const compactValue = value.replace(/(\$[\d,.]+)\s*(billion|million|trillion)\b/gi,
    (_, amount: string, scale: string) => amount + ({ billion: "B", million: "M", trillion: "T" }[scale.toLowerCase()]));
  return <div className="fd-cyber-metric">
    <dt>{label}</dt>
    <dd className="fd-cyber-number" title={value}>{compactValue}</dd>
    {item?.conflict?.length ? <dd className="fd-cyber-disputed">Reports differ · see Details</dd> : null}
    {item && <dd><Evidence item={item} sources={sources} compact={compact} /></dd>}
  </div>;
}

export function CyberIncidentOverview({ headline, metrics, services, advisories, timeline, tables = [], resources = [], trends = [], sources, lastChecked }: {
  headline?: HeaderData["headline"];
  metrics: StatItem[];
  services: StatusGridData["items"];
  advisories: AlertListData["items"];
  timeline?: TimelineData;
  tables?: TableData[];
  resources?: LinkListData["items"];
  trends?: TrendData[];
  sources: Map<string, Source>;
  lastChecked: string | null;
}) {
  const figures = recoveryMetrics(metrics);
  const chart = selectCyberTrend(trends, metrics, sources);
  const primary = primaryService(services);
  const state = primary?.state ?? "unknown";
  const scopes = scopeReports(tables, services);
  const statusLink = resourceFor(resources, "availability");
  const verificationLink = resourceFor(resources, "verification");
  const guidanceLink = resourceFor(resources, "guidance");
  const announcementLink = resourceFor(resources, "updates");
  const actionLinks = [verificationLink, guidanceLink, announcementLink].filter((item, index, all) =>
    item && all.findIndex(other => other?.url === item.url) === index);
  const notice = userAdvisory(advisories, sources);
  const instructions = notice?.text.split(/(?<=\.)\s+|,\s+(?=(?:enable|and never)\b)/i).filter(Boolean) ?? [];
  const latest = timeline?.items.filter(item => toMs(item.at) !== null && item.sources.some(id => {
    const source = sources.get(id);
    return source && source.via !== "x" && hostOf(source.url);
  })).sort((a, b) => (toMs(b.at) ?? -Infinity) - (toMs(a.at) ?? -Infinity))[0];

  return <div className="fd-cyber-user" data-has-chart={chart ? "" : undefined}>
    <Card padding="sm" radius="lg" className="fd-cyber-user-status" role="region" aria-label="Current status">
      <header><Icon name="activity" width={20} height={20} /><span>{primary?.name ?? "Service availability"}</span>
        <Badge variant={state === "operational" ? "success" : state === "unknown" ? "neutral" : "warning"}>Reported status</Badge>
      </header>
      <h3>{states[state]}</h3>
      <p>{primary?.note || headline?.text || "Awaiting a sourced status update."}</p>
      {primary && <Evidence item={primary} sources={sources} />}
    </Card>

    <div className="fd-cyber-user-priorities">
      <Card padding="sm" radius="lg" className="fd-cyber-user-scope" role="region" aria-label="Affected scope">
        <header><Icon name="filter" width={20} height={20} /><h3>Does this affect you?</h3></header>
        <div className="fd-cyber-scope-list">
          {scopes.slice(0, 3).map(scope => <article key={scope.id} className="fd-cyber-scope-row">
            <strong>{scope.label}</strong>
            <span className="fd-cyber-scope-state">{scope.status}</span>
            {scope.note && <p className="fd-cyber-scope-note">{scope.note}</p>}
            <Evidence item={scope} sources={sources} />
          </article>)}
          {!scopes.length && <p>Affected services or products have not been identified in the collected reports.</p>}
        </div>
        <ResourceChip resource={statusLink} sources={sources} />
        {scopes.length > 3 && <p className="fd-cyber-small">{scopes.length} reported entries · full list in Details</p>}
      </Card>

      <Card padding="sm" radius="lg" className="fd-cyber-user-actions" role="region" aria-label="User guidance">
        <header><Icon name="user" width={20} height={20} /><h3>What you can do</h3></header>
        {notice ? <div className="fd-cyber-action-copy">
          <p className="fd-cyber-small">{notice.issuer} · official guidance</p>
          <ul className="fd-cyber-instructions">{instructions.map((text, index) =>
            <li key={index}>{text.replace(/^and /i, "").replace(/^./, letter => letter.toUpperCase())}</li>
          )}</ul>
          <Evidence item={notice} sources={sources} />
        </div> : <p>No user-specific instructions have been verified in the collected reports.</p>}
        <div className="fd-cyber-action-links">
          {actionLinks.map(resource => resource && <ResourceChip key={resource.id} resource={resource} sources={sources} />)}
        </div>
      </Card>
    </div>

    <Card padding="sm" radius="lg" className="fd-cyber-user-recovery" role="region" aria-label="Impact">
      <header><Icon name="chart" width={20} height={20} /><h3>Impact & recovery</h3><span className="fd-cyber-small">Incident-wide reports</span></header>
      <div className={`fd-cyber-recovery-body${chart ? " fd-cyber-recovery-with-chart" : ""}`}>
      <dl className="fd-cyber-summary-figures">
        {figures.map(({ role, item }) => <div key={role} role="region" aria-label={role === "response" ? "Response" : role === "recovery" ? "Recovery" : "Reported impact"}>
          <Metric compact={!!chart} item={item} label={item?.label ?? ({ impact: "Reported impact", response: "Response measures", recovery: "Recovery progress" }[role])} sources={sources} />
        </div>)}
      </dl>
      {chart && <section className="fd-cyber-overview-chart" aria-label="Reported trend">
        <h4>{chart.label}</h4>
        <CyberTrend data={chart} sources={sources} compact />
        <Evidence item={{ asOf: chart.points.at(-1)?.t ?? null, sources: [...new Set(chart.points.flatMap(point => point.sources))] }} sources={sources} />
      </section>}
      </div>
    </Card>

    {!chart && <Card padding="sm" radius="lg" className="fd-cyber-user-latest" role="region" aria-label="Latest reported event">
      <div><span className="fd-cyber-small">Latest reported event</span><h3>{latest?.title ?? "Awaiting a dated update"}</h3></div>
      {latest && <Evidence item={{ ...latest, asOf: latest.at }} sources={sources} />}
      {lastChecked && <time className="fd-cyber-checked" dateTime={lastChecked} title={when(lastChecked)}>Board checked {day.format(toMs(lastChecked) ?? 0)}</time>}
    </Card>}
  </div>;
}
