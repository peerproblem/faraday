"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaChart, BarList, ChartCard, Tracker } from "@/components/ui/charts";
import { Text } from "@/components/ui/typography";
import { cleanPoints, trendSummary } from "@/components/widgets/chart";
import { SourceChips } from "@/components/widgets/source-chips";
import { getStatItems } from "@/components/widgets/stat-grid";
import type { StatGridData, TrendData, Widget } from "@/lib/spec";
import { when } from "@/lib/time";
import { incidentDays, incidentKindColor, incidentKindLabel, incidentKinds, type Incident, type IncidentKind } from "./blockade-data";
import { Dot } from "./widget";
import { PanelSection, type BlockadeContext } from "./widget";

const FIRST = 8;

const shortKind: Record<IncidentKind, string> = {
  mine: "Mine strike", enforcement: "U.S. strike", attack: "Attack", stopped: "Turned back", other: "Report",
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const count = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

export function MaritimePanel({ context, incidents, now, trend, trendData, stats }: {
  context: BlockadeContext;
  incidents: Incident[];
  now: number;
  trend: Widget | undefined;
  trendData: TrendData | undefined;
  stats: StatGridData | undefined;
}) {
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [all, setAll] = useState(false);
  const points = cleanPoints(trendData?.points ?? []);
  const figure = getStatItems(stats).find((item) => item.key === trendData?.metric);
  const lastPoint = trendData?.points[trendData.points.length - 1];
  const days = incidentDays(incidents, now);
  const reported = days.filter((entry) => entry.count > 0).length;
  const kinds = incidentKinds(incidents);
  const matching = kind ? incidents.filter((incident) => incident.kind === kind) : incidents;
  const shown = all || kind ? matching : matching.slice(0, FIRST);

  return (
    <>
      {trend && trendData && points.length > 1 && (
        <ChartCard title={trendData.label} value={figure?.valueText ?? points[points.length - 1].v.toLocaleString("en-US")}
          description={figure?.delta ?? undefined} variant="ghost" padding="none" bordered={false} className="fd-blockade-chart min-w-0">
          <AreaChart
            data={points.map((point) => ({ t: new Date(point.x), v: point.v }))}
            x="t"
            series={[{ key: "v", label: trendData.unit ? `${trendData.label} (${trendData.unit})` : trendData.label }]}
            curve="linear"
            height={148}
            yDomain={[0, undefined]}
            xFormat={(value) => (value instanceof Date ? day(value.getTime()) : String(value))}
            yFormat={(value) => value.toLocaleString("en-US")}
            aria-label={trendSummary(trendData.label, trendData.points, trendData.unit)}
          />
          {lastPoint && (
            <div className="flex flex-wrap items-center gap-2">
              <Text as="span" size="sm" tone="muted">Latest count {when(lastPoint.t)}</Text>
              <SourceChips ids={lastPoint.sources} sources={context.sources} />
            </div>
          )}
        </ChartCard>
      )}

      {incidents.length > 0 && (
        <PanelSection title="Incident reports by day" aside={`${reported} of ${days.length} days`}>
          <Tracker
            aria-label={`Maritime incident reports over the last ${days.length} days: reports on ${count(reported, "day")}.`}
            height={28}
            items={days.map((entry) => ({
              status: entry.count === 0 ? "none" : entry.count < 3 ? "degraded" : "down",
              label: `${day(entry.day)}: ${entry.count === 0 ? "no reports" : count(entry.count, "report")}`,
            }))}
          />
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums" aria-hidden="true">
            <span>{day(days[0].day)}</span>
            <span>{day(days[days.length - 1].day)}</span>
          </div>
        </PanelSection>
      )}

      {kinds.length > 1 && (
        <PanelSection title="What the reports describe" aside={kind && (
          <Button size="sm" variant="ghost" onClick={() => setKind(null)}>Show all</Button>
        )}>
          <BarList aria-label="Incident reports by type"
            items={kinds.map((item) => ({ ...item, icon: <Dot color={incidentKindColor[item.id]} /> }))} format={(value) => value.toLocaleString("en-US")}
            onItemAction={(id) => setKind(id === kind ? null : id as IncidentKind)} />
          <Text size="sm" tone="muted">Several sources can report the same event. Select a row to filter the list.</Text>
        </PanelSection>
      )}

      {incidents.length > 0 && (
        <PanelSection title={kind ? incidentKindLabel[kind] : "Incident reports"} aside={count(matching.length, "report")}>
          <ul className="fd-blockade-records" aria-label="Maritime incident reports">
            {shown.map((incident) => (
              <li key={incident.id}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <Text size="sm" className="min-w-0 font-medium">{incident.subject}</Text>
                  <Badge variant="outline" className="shrink-0" leading={<Dot color={incidentKindColor[incident.kind]} />}>{shortKind[incident.kind]}</Badge>
                </div>
                <Text size="sm" tone="subtle">
                  {incident.action}{incident.status && <span className="text-muted-foreground">{`. ${incident.status}`}</span>}
                </Text>
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="span" size="sm" tone="muted" className="tabular-nums">
                    {incident.at !== null ? <time dateTime={new Date(incident.at).toISOString()}>{when(new Date(incident.at).toISOString())}</time> : incident.timeText || "Time not reported"}
                  </Text>
                  <SourceChips ids={incident.sources} sources={context.sources} evidence={incident.evidence} />
                </div>
              </li>
            ))}
          </ul>
          {!all && !kind && matching.length > FIRST && (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => setAll(true)}>
              Show all {matching.length} reports
            </Button>
          )}
        </PanelSection>
      )}
    </>
  );
}
