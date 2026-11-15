"use client";

import "./transport.css";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OfficialReleasesContext, SourceChips } from "@/components/widgets/source-chips";
import type { Cited, HeaderData, Source, TimelineData } from "@/lib/spec";
import { when } from "@/lib/time";
import { networkMilestone, noticeKind, recoveryForecast, statusTone, type TransportGroup, type TransportNotice, type TransportSection } from "./transport-model";

type Props = { header: HeaderData; sections: TransportSection[]; notices: TransportNotice[]; timeline?: TimelineData; sources: Map<string, Source>; checkedAt: string | null };
function Evidence({ item, sources }: { item: Cited; sources: Map<string, Source> }) {
  return <div className="fd-transport-evidence"><span>{item.asOf ? `Reported ${when(item.asOf)}` : "Report time unknown"}</span>
    <OfficialReleasesContext.Provider value={[]}><SourceChips ids={item.sources} sources={sources} evidence={item.evidence} collapseAt={2} compactLabel /></OfficialReleasesContext.Provider>
  </div>;
}
function Pager({ page, count, onChange, label }: { page: number; count: number; onChange: (n: number) => void; label: string }) {
  return <nav aria-label={`${label} pages`} className="fd-transport-pager">
    <Button size="sm" variant="ghost" aria-label={`Previous ${label}`} disabled={!page} onClick={() => onChange(page - 1)}>←</Button>
    <span>{page + 1} / {Math.max(1, count)}</span>
    <Button size="sm" variant="ghost" aria-label={`Next ${label}`} disabled={page + 1 >= count} onClick={() => onChange(page + 1)}>→</Button>
  </nav>;
}
function ReportPanel({ section, size, sources, onSelect }: { section: TransportSection; size: number; sources: Map<string, Source>; onSelect: (id: string) => void }) {
  const [requested, setPage] = useState(0);
  const count = Math.ceil(section.groups.length / size), page = Math.min(requested, Math.max(0, count - 1));
  return <Card padding="none" radius="lg" className="fd-transport-report-panel">
    <header><div><h3>{section.label}</h3><small>{section.groups.length} listed · dated reports first</small></div><Pager page={page} count={count} onChange={setPage} label={section.label} /></header>
    <div className="fd-transport-rows">{section.groups.slice(page * size, (page + 1) * size).map(group => {
      const report = group.reports[0];
      return <article className="fd-transport-row" key={group.id}>
        <button className="fd-transport-report-button" onClick={() => onSelect(group.id)} aria-label={`Reports for ${group.name}`}>
          <strong>{group.name}</strong><span className="fd-transport-report-count">{group.reports.length > 1 ? `${group.reports.length} reports` : "↗"}</span>
        </button>
        <div className="fd-transport-status"><span className={`fd-transport-dot fd-transport-dot-${statusTone(report.status)}`} /><span>{report.status}</span></div>
        {report.fields[0] && <p className="fd-transport-row-note" title={`${report.fields[0].label}: ${report.fields[0].value}`}>{report.fields[0].value}</p>}
        <Evidence item={report} sources={sources} />
      </article>;
    })}{!section.groups.length && <p className="fd-transport-empty">No matching status reports collected yet. Details retains all available reports.</p>}</div>
  </Card>;
}
function ReportHistory({ group, sources }: { group: TransportGroup; sources: Map<string, Source> }) {
  return <div className="fd-transport-report-history">{group.reports.map((report, index) => <article key={`${report.id}:${index}`}>
    <h4>{report.name}</h4><div className="fd-transport-status"><span className={`fd-transport-dot fd-transport-dot-${statusTone(report.status)}`} /><span>{report.status}</span></div>
    <Evidence item={report} sources={sources} />
    <dl>{report.fields.map((field, i) => <div key={i}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
  </article>)}</div>;
}
export function TransportOverview({ header, sections, notices, timeline, sources, checkedAt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(2);
  const [selected, setSelected] = useState<string | null>(null);
  const [noticePage, setNoticePage] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize(entry.contentRect.width < 540 ? 2 : entry.contentRect.height >= 1050 ? 4 : entry.contentRect.height >= 820 ? 3 : 2));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const milestone = networkMilestone(timeline);
  const forecast = header.status !== "resolved" ? recoveryForecast(timeline) : undefined;
  const group = sections.flatMap(s => s.groups).find(g => g.id === selected);
  const notice = notices.find(n => `notice:${n.id}` === selected);
  const noticeSize = size >= 3 ? 2 : 1;
  const page = Math.min(noticePage, Math.max(0, Math.ceil(notices.length / noticeSize) - 1));
  const status = header.status ? { developing: "Situation developing", ongoing: "Disruption ongoing", contained: "Incident contained", recovering: "Recovery in progress", resolved: "Reported resolved" }[header.status] : "Status not reported";
  return <div ref={ref} className="fd-transport-dashboard">
    <header className="fd-transport-heading"><div><span className="fd-transport-eyebrow">TRANSPORT · OPERATIONS WATCH</span><h2>Travel recovery & service status</h2></div><small>{checkedAt ? `Checked ${when(checkedAt)}` : "Awaiting first check"}</small></header>
    <Card padding="none" radius="lg" className="fd-transport-summary">
      <div><span className="fd-transport-eyebrow">OVERALL SITUATION</span><h3>{status}</h3>{forecast ? <><p><strong>Estimate:</strong> {forecast.title}</p><Evidence item={{ ...forecast, asOf: forecast.at }} sources={sources} /></> : <p>Compare reported conditions below. A lifted restriction does not confirm normal service.</p>}</div>
      <div><span className="fd-transport-eyebrow">LATEST NETWORK MILESTONE</span><strong>{milestone?.title ?? "No dated network milestone yet"}</strong>{milestone ? <Evidence item={{ ...milestone, asOf: milestone.at }} sources={sources} /> : <small>See Timeline for reported developments.</small>}</div>
    </Card>
    <div className="fd-transport-comparison">{sections.map(section => <ReportPanel key={section.label} section={section} size={size} sources={sources} onSelect={setSelected} />)}</div>
    <Card padding="none" radius="lg" className="fd-transport-notices"><header><div><h3>Latest advisories & guidance</h3><small>Dated notices first · forecasts are not active restrictions</small></div><Pager page={page} count={Math.ceil(notices.length / noticeSize)} onChange={setNoticePage} label="notices" /></header>
      {notices.slice(page * noticeSize, (page + 1) * noticeSize).map(item => <article key={item.id}>
        <div><Badge variant={noticeKind(item) === "Advisory" ? "warning" : "neutral"}>{noticeKind(item)}</Badge><span className="fd-transport-issuer">{item.issuer}</span></div>
        <button className="fd-transport-report-button" onClick={() => setSelected(`notice:${item.id}`)}><strong>{item.title}</strong><span aria-hidden>↗</span></button>
        <Evidence item={item} sources={sources} />
      </article>)}
      {!notices.length && <p className="fd-transport-empty">No advisories collected yet. News reports remain available in Details and Timeline.</p>}
    </Card>
    <Dialog open={!!(group || notice)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{group?.name ?? notice?.title ?? "Report details"}</DialogTitle><DialogDescription>{group ? "All collected reports are preserved. Different dates and conditions may apply; an undated report is not assumed to be the latest." : "Reported notice and its sources. Check applicability and validity before treating a forecast as an active restriction."}</DialogDescription></DialogHeader>
      <DialogBody>{group ? <ReportHistory group={group} sources={sources} /> : notice ? <div className="fd-transport-report-history"><Badge variant="neutral">{noticeKind(notice)}</Badge><h4>{notice.issuer}</h4><p>{notice.text}</p><Evidence item={notice} sources={sources} /></div> : null}</DialogBody>
    </DialogContent></Dialog>
  </div>;
}
export function TransportSituation({ header, sections, sources }: Pick<Props, "header" | "sections" | "sources">) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const section = sections.find(s => s.label === selected) ?? sections[0];
  const search = query.trim().toLocaleLowerCase();
  const groups = section?.groups.filter(group => group.reports.some(report =>
    `${report.name} ${report.status} ${report.fields.map(field => field.value).join(" ")}`.toLocaleLowerCase().includes(search),
  )) ?? [];
  return <div className="fd-transport-situation">
    <section className="fd-transport-situation-brief">
      <h3>Situation at a glance</h3>
      <p>{header.headline?.text || header.subtitle || "No situation summary reported yet."}</p>
      {header.headline && <SourceChips ids={header.headline.sources} sources={sources} collapseAt={3} compactLabel />}
    </section>
    <div className="fd-transport-situation-tools">
      <SegmentedControl aria-label="Transport report category" size="sm" fullWidth
        value={section?.label ?? ""} onValueChange={value => { setSelected(value); setQuery(""); }}
        options={sections.map(s => ({ value: s.label, label: `${s.label.split(" & ")[0]} (${s.groups.length})` }))} />
      <Input aria-label="Find transport reports" placeholder="Find a place, operator or condition…" size="sm"
        value={query} onValueChange={setQuery} clearable />
      <p className="fd-transport-muted" role="status">{groups.length} of {section?.groups.length ?? 0} listed · dated reports first</p>
    </div>
    <div className="fd-transport-situation-reports" aria-label={section?.label}>
      {groups.map(group => {
        const report = group.reports[0];
        return <details key={group.id}>
          <summary>
            <span className="fd-transport-report-name">{group.name}</span>
            <span className="fd-transport-status"><span className={`fd-transport-dot fd-transport-dot-${statusTone(report.status)}`} /><span>{report.status}</span></span>
            <small>{report.asOf ? `Reported ${when(report.asOf)}` : "Report time unknown"} · {group.reports.length} {group.reports.length === 1 ? "report" : "reports"}</small>
          </summary>
          <ReportHistory group={group} sources={sources} />
        </details>;
      })}
      {!groups.length && <p className="fd-transport-empty">{search ? "No matching reports in this category. Try another name or condition." : "No status reports collected in this category yet."}</p>}
    </div>
    <p className="fd-transport-muted">Reports may cover different dates and services. Waivers and advisories do not confirm restored service. Data keeps the full tables and resources.</p>
  </div>;
}
