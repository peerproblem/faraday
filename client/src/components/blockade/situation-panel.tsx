"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkline, Tracker, TrendChart } from "@/components/ui/charts";
import { DashboardGrid, DashboardTile } from "@/components/ui/dashboard";
import { Meter } from "@/components/ui/meter";
import { Stat } from "@/components/ui/stat";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import {
  Timeline, TimelineConnector, TimelineContent, TimelineItem, TimelineMarker, TimelineTime, TimelineTitle,
} from "@/components/ui/timeline";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "@/components/widgets/source-chips";
import { getStatItems } from "@/components/widgets/stat-grid";
import type { AlertListData, HeaderData, NarrativeData, StatGridData, TimelineData, Widget } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import { figureOf, incidentDays, issuerSide, latestEvents, type Incident } from "./blockade-data";
import { BoardWidget, PanelSection, type BlockadeContext } from "./widget";

const WEEK = 7 * 86_400_000;

export function SituationPanel({ context, header, lastPolledAt, now, narrative, stats, incidents, advisories, timeline, timelineData, social }: {
  context: BlockadeContext;
  header: HeaderData | null;
  lastPolledAt: number | null;
  now: number;
  narrative: NarrativeData | undefined;
  stats: StatGridData | undefined;
  incidents: Incident[];
  advisories: AlertListData["items"];
  timeline: Widget | undefined;
  timelineData: TimelineData | undefined;
  social: Widget | undefined;
}) {
  const [tab, setTab] = useState("overview");
  const sentences = (narrative?.sentences ?? []).filter((sentence) => sentence && typeof sentence.text === "string" && sentence.text.trim());
  const events = (timelineData?.items ?? []).filter((item) => item && typeof item.id === "string" && item.title);
  const latest = latestEvents(events);
  const active = advisories.filter((item) => item.active);
  const week = incidents.filter((incident) => incident.at !== null && now - incident.at <= WEEK).length;
  const weekDays = incidentDays(incidents, now, 7);
  const reported = getStatItems(stats).slice(0, 2).map(figureOf);
  const checked = lastPolledAt == null ? null : new Date(lastPolledAt).toISOString();

  return (
    <Tabs value={tab} onValueChange={setTab} size="sm" className="fd-workspace-tabs">
      <TabsList aria-label="Situation views" className="fd-workspace-tab-list">
        <Tab value="overview">Overview</Tab>
        {timeline && <Tab value="timeline" aria-label={`Timeline, ${events.length}`}>
          Timeline <span className="ml-1 text-xs text-muted-foreground tabular-nums">{events.length}</span>
        </Tab>}
        {social && <Tab value="social">On the ground</Tab>}
      </TabsList>

      <TabsPanel value="overview" className="fd-workspace-tab-body fd-blockade-panel">
        <section className="fd-blockade-section" aria-label="Summary">
          {header?.headline?.text && (
            <Text className="fd-blockade-lede">
              {header.headline.text}{" "}
              <SourceChips ids={header.headline.sources} sources={context.sources} collapseAt={4} compactLabel />
            </Text>
          )}
          {typeof header?.severity === "number" && (
            <Meter label="Severity" value={Math.min(5, Math.max(0, header.severity))} min={0} max={5}
              low={2} high={4} optimum={0} size="sm"
              formatOptions={{ style: "decimal", maximumFractionDigits: 1 }} getValueLabel={(value) => `${value} of 5`} />
          )}
          {checked && (
            <Text size="sm" tone="muted">Last checked <time dateTime={checked}>{when(checked)}</time></Text>
          )}
        </section>

        {(reported.length > 0 || incidents.length > 0 || active.length > 0) && (
          <DashboardGrid aria-label="Key figures" variant="joined" columns={2} minTileWidth={132} radius="lg" className="fd-blockade-figures">
            {reported.map((figure, index) => (
              <DashboardTile key={figure.key} id={figure.key} span={1} padding="sm">
                <Stat size="sm" label={figure.label} value={figure.value} caption={figure.caption}>
                  {figure.history && <Sparkline data={figure.history} height={28} color={index ? "var(--sw-chart-4)" : "var(--sw-chart-1)"} />}
                </Stat>
              </DashboardTile>
            ))}
            {incidents.length > 0 && (
              <DashboardTile id="incident-reports" span={1} padding="sm">
                <Stat size="sm" label="Incidents, 7 days" value={String(week)} caption={`${incidents.length} on record`}>
                  <TrendChart spark variant="bars" tone="danger" height={28} values={weekDays.map((entry) => entry.count)} />
                </Stat>
              </DashboardTile>
            )}
            {active.length > 0 && (
              <DashboardTile id="active-advisories" span={1} padding="sm">
                <Stat size="sm" label="Active advisories" value={String(active.length)}
                  caption={`${new Set(active.map((item) => issuerSide(item.issuer))).size} issuing sides`}>
                  <Tracker height={28} aria-label={`${active.length} active advisories, one tick each, by level`}
                    items={active.map((item) => ({
                      status: item.level === "warning" ? "down" : item.level === "watch" ? "degraded" : "none",
                      label: `${item.level === "warning" ? "Warning" : item.level === "watch" ? "Watch" : "Info"}: ${item.title}`,
                    }))} />
                </Stat>
              </DashboardTile>
            )}
          </DashboardGrid>
        )}

        {latest.length > 0 && (
          <PanelSection title="Latest developments" aside={timeline && (
            <Button size="sm" variant="ghost" onClick={() => setTab("timeline")}>All {events.length}</Button>
          )}>
            <Timeline aria-label="Latest developments" size="sm">
              {latest.map((event) => (
                <TimelineItem key={event.id} value={event.id} importance={event.importance === "high" ? "high" : "normal"}>
                  <TimelineMarker />
                  <TimelineConnector />
                  <TimelineContent>
                    <TimelineTitle>{event.title}</TimelineTitle>
                    <TimelineTime dateTime={toMs(event.at) !== null ? (event.at ?? undefined) : undefined}>{when(event.at)}</TimelineTime>
                  </TimelineContent>
                </TimelineItem>
              ))}
            </Timeline>
          </PanelSection>
        )}

        {sentences.length > 0 && (
          <PanelSection title="Briefing">
            {sentences.map((sentence, index) => (
              <Text key={`${index}-${sentence.text.slice(0, 24)}`} size="sm" className="fd-blockade-briefing">
                {sentence.text}{" "}
                <SourceChips ids={sentence.sources} sources={context.sources} collapseAt={4} compactLabel />
              </Text>
            ))}
          </PanelSection>
        )}
      </TabsPanel>

      {timeline && (
        <TabsPanel value="timeline" className="fd-workspace-tab-body fd-blockade-panel">
          <BoardWidget widget={timeline} context={context} />
        </TabsPanel>
      )}
      {social && (
        <TabsPanel value="social" className="fd-workspace-tab-body fd-blockade-panel">
          <BoardWidget widget={social} context={context} />
        </TabsPanel>
      )}
    </Tabs>
  );
}
