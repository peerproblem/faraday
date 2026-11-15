"use client";

import "./blockade.css";
import { useMemo, useState, type ReactNode } from "react";
import { AgentBridge } from "@/components/board/agent-bridge";
import { isBuilding } from "@/components/board/board";
import { ContextEvidence } from "@/components/board/context-evidence";
import { BoardToasts, useLiveBoard } from "@/components/board/live-board";
import { BoardWorkspace } from "@/components/board/workspace";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Heading } from "@/components/ui/typography";
import { MapWidget } from "@/components/widgets/map";
import { OfficialReleasesContext } from "@/components/widgets/source-chips";
import { WidgetBoundary } from "@/components/widgets/widget-frame";
import { SITE_URL } from "@/lib/config";
import type {
  AlertListData, BoardView, LinkListData, MapData, NarrativeData, StatGridData, TableData, TimelineData, TrendData,
} from "@/lib/spec";
import { AdvisoriesPanel } from "./advisories-panel";
import { blockadeWidgets, bordersOf, hormuzArea, incidentsOf, mapPoints, type MapLayer } from "./blockade-data";
import { BordersPanel } from "./borders-panel";
import { DetailTabs } from "./detail-tabs";
import { EvidencePanel } from "./evidence-panel";
import { MapLegend } from "./map-legend";
import { MaritimePanel } from "./maritime-panel";
import { SituationPanel } from "./situation-panel";
import type { BlockadeContext } from "./widget";

const situationLabel: Record<string, string> = {
  developing: "Developing", ongoing: "Ongoing", contained: "Contained", recovering: "Recovering", resolved: "Resolved",
};

const layers: { value: MapLayer | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sea", label: "Sea" },
  { value: "land", label: "Borders" },
];

/** The blockade board: a briefing on the left, the map in the middle, and the sea, border and advisory records on the right. */
export function LiveBlockadeBoard({ initial, navigation }: { initial: BoardView; navigation?: ReactNode }) {
  const { board, spec, data, connected } = useLiveBoard(initial);
  const [layer, setLayer] = useState<MapLayer | "all">("all");
  const sources = board.sources;
  const byId = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const building = isBuilding(board.status);
  const header = data?.header ?? null;
  const title = header?.title ?? board.title ?? "Live board";
  const live = !building && connected && board.tier !== "paused";

  const widgets = useMemo(() => blockadeWidgets(spec, data), [spec, data]);
  const dataOf = <T,>(id: string | undefined) => (id ? data?.widgets[id] as T | undefined : undefined);
  const incidentTable = dataOf<TableData>(widgets.incidents?.id);
  const crossingTable = dataOf<TableData>(widgets.crossings?.id);
  const advisories = dataOf<AlertListData>(widgets.advisories?.id);
  const located = dataOf<MapData>(widgets.map?.id);
  const links = dataOf<LinkListData>(widgets.links?.id);
  const timeline = dataOf<TimelineData>(widgets.timeline?.id);

  const incidents = useMemo(() => incidentsOf(incidentTable), [incidentTable]);
  const borders = useMemo(() => bordersOf(crossingTable), [crossingTable]);
  const advisoryItems = useMemo(
    () => (advisories?.items ?? []).filter((item) => item && typeof item.id === "string" && item.title),
    [advisories],
  );
  const points = useMemo(() => mapPoints(located?.points ?? [], incidents, borders), [located, incidents, borders]);
  const area = useMemo(() => hormuzArea(advisoryItems), [advisoryItems]);
  const releases = useMemo(
    () => (links?.items ?? []).filter((item) => item?.kind === "official" && /^https?:\/\//.test(item.url)),
    [links],
  );

  const context: BlockadeContext = {
    data, sources: byId, allSources: sources, events: board.events, status: board.status, tier: board.tier, building,
  };
  const shown = layer === "all" ? points : points.filter((point) => point.layer === layer);
  const mapData: MapData = { center: located?.center ?? header?.location ?? null, points: shown };
  // The clock every panel counts days from: the last check of the web, so server and browser agree.
  const now = board.lastPolledAt ?? board.updatedAt;

  return (
    <OfficialReleasesContext.Provider value={releases}>
      <div className="@container fd-workspace-board fd-blockade">
        <header className="fd-workspace-header flex min-w-0 shrink-0 items-center gap-2 border-b border-hairline">
          <Button href={`${SITE_URL}/`} variant="ghost" size="sm" iconOnly aria-label="Faraday home"
            className="shrink-0" leading={<LogoMark className="h-5 w-5" />} />
          <Heading as="h1" size="sm" className="fd-workspace-title min-w-0 truncate" title={title}>{title}</Heading>
          <div className="fd-blockade-status flex min-w-0 flex-1 items-center gap-1.5">
            <Badge variant={building ? "accent" : live ? "success" : "neutral"} pulse={live || building}>
              {building ? "Building" : board.tier === "paused" ? "Paused" : connected ? "Live" : "Offline"}
            </Badge>
            {header?.status && <Badge variant="outline">{situationLabel[header.status] ?? header.status}</Badge>}
          </div>
          {navigation}
        </header>
        <BoardWorkspace
          key={`blockade:${board.id}`}
          workspaceKey={`blockade:${board.id}`}
          sourceCount={sources.length}
          overview={null}
          sections={[]}
          sidebar={{
            title: "Situation",
            ariaLabel: "Situation briefing",
            content: (
              <SituationPanel context={context} header={header} lastPolledAt={board.lastPolledAt} now={now}
                narrative={dataOf<NarrativeData>(widgets.narrative?.id)} stats={dataOf<StatGridData>(widgets.stats?.id)} incidents={incidents}
                advisories={advisoryItems} timeline={widgets.timeline} timelineData={timeline} social={widgets.social} />
            ),
          }}
          map={widgets.map ? (
            <>
              <WidgetBoundary resetKey={mapData.points.length}>
                <MapWidget key={layer} widget={{ ...widgets.map, type: "map" }} data={mapData} sources={byId}
                  allSources={sources} events={board.events} status={board.status} tier={board.tier} building={building}
                  fillMap nameMarkers areas={area && layer !== "land" ? [area] : undefined} />
              </WidgetBoundary>
              <div className="fd-blockade-map-layers">
                <SegmentedControl<MapLayer | "all"> aria-label="Places shown on the map" size="sm" value={layer} onValueChange={setLayer} options={layers} />
                <MapLegend kinds={[...new Set(shown.map((point) => point.kind))]} area={area && layer !== "land" ? area.label : undefined} />
              </div>
            </>
          ) : undefined}
          details={
            <DetailTabs
              maritime={<MaritimePanel context={context} incidents={incidents} now={now}
                trend={widgets.interdictions} trendData={dataOf<TrendData>(widgets.interdictions?.id)}
                stats={dataOf<StatGridData>(widgets.stats?.id)} />}
              borders={<BordersPanel context={context} borders={borders} />}
              advisories={<AdvisoriesPanel context={context} widget={widgets.advisories} items={advisoryItems}
                links={widgets.links} />}
              evidence={<EvidencePanel context={context} sources={widgets.sources} changelog={widgets.changelog}
                contextEvidence={<ContextEvidence boardId={board.id} checkedAt={board.lastPolledAt} />} />}
              counts={{ maritime: incidents.length, borders: borders.reduce((sum, border) => sum + border.crossings.length + border.overall.length, 0), advisories: advisoryItems.filter((item) => item.active).length }}
            />
          }
        />
      </div>
      <BoardToasts />
      <AgentBridge />
    </OfficialReleasesContext.Provider>
  );
}
