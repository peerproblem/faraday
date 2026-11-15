"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardGrid } from "@/components/ui/dashboard";
import { Separator } from "@/components/ui/separator";
import { SourceStack } from "@/components/sources/source-mark";
import { SourceWire } from "@/components/sources/source-wire";
import { WidgetBoundary, WidgetFrame } from "@/components/widgets/widget-frame";
import { outletsOf, wireItems } from "@/lib/source-brand";
import { Meter } from "@/components/ui/meter";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Caption, Display, Heading, Text } from "@/components/ui/typography";
import { clientComputed, widgetComponent } from "@/components/widgets/registry";
import { OfficialReleases, OfficialReleasesContext, SourceChips } from "@/components/widgets/source-chips";
import { getStatItems, MapFigureCards } from "@/components/widgets/stat-grid";
import { TimelineWidget } from "@/components/widgets/timeline";
import { SITE_URL } from "@/lib/config";
import { widgetKeyOf, type AlertListData, type StatusGridData, type TimelineData, type TrendData, type BoardCardContent, type BoardCardSettings, type BoardData, type BoardEvent, type BoardLayoutCard, type BoardMapRegion, type BoardSpecV2, type BoardStatus, type BoardTier, type LinkListData, type MapData, type Source, type StatGridData, type TableData, type Widget } from "@/lib/spec";
import { newest, when } from "@/lib/time";
import type { BoardEntry } from "./entry";
import { OutageOverview, OutageSituation, type OutageProps } from "./outage-overview";
import { CyberIncidentOverview } from "./cyber-incident-overview";
import { BoardHeaderButton } from "./header-button";
import { ContextEvidence } from "./context-evidence";
import { HouthiCards } from "./houthi-cards";
import { houthiContextSources, houthiTimeline } from "./houthi-context";
import { HouthiReplay } from "./houthi-replay";
import { latestRestrictionFigure, selectMapFigures } from "./map-figures";
import { BoardWorkspace } from "./workspace";
import { StatusBreakdown } from "./status-breakdown";
import { StrikeDayChart, StrikeMapFigures, StrikeOverview } from "./strike-overview";
import { automaticChartEntry } from "./automatic-chart";
import { IncidentReports } from "./incident-reports";
import { RegionSwitch, RegionInset } from "./map-regions";
import { MapWidget } from "@/components/widgets/map";
import "@/components/wildfire/wildfire.css";
import type { WildfireBoard } from "@/components/wildfire/boards";
import { FireLog } from "@/components/wildfire/fire-log";
import { wildfireView } from "@/components/wildfire/wildfire-data";
import { WildfireOverview } from "@/components/wildfire/wildfire-overview";

export type BoardProps = {
  boardId?: string;
  spec: BoardSpecV2 | null;
  data: BoardData | null;
  specVersion: number;
  title: string | null;
  prompt: string;
  sources: Source[];
  events: BoardEvent[];
  status: BoardStatus;
  tier: BoardTier;
  stage?: string;
  connected: boolean;
  lastPolledAt: number | null;
  snapshotAt?: number;
  onRefresh?: () => Promise<unknown>;
  /** When the stream last changed each widget's data, by widget id. */
  updatedAt?: Record<string, number>;
  /** Extra controls in the header. */
  actions?: ReactNode;
  workspace?: boolean;
  cardsOnMap?: boolean;
  defaultTimelineOpen?: boolean;
  defaultEvidenceOpen?: boolean;
  overviewStatusChart?: string;
  incidentOverview?: { status: boolean; tally: boolean };
  /** Draws the board with the wildfire design. */
  wildfire?: WildfireBoard;
  /** The general strike board: its own figures, overview and panel widths. */
  strikeOverview?: boolean;
  houthiBriefing?: boolean;
  workspaceNavigation?: ReactNode;
  workspaceKey?: string;
  sidebarSettings?: BoardCardSettings | null;
  configuredCards?: BoardLayoutCard[];
  mapCard?: BoardCardSettings;
  mapRegions?: BoardMapRegion[];
};

const stageText: Record<string, string> = {
  queued: "Queued",
  planning: "Planning what to track",
  gathering: "Reading the live web through Context.dev",
  composing: "Reading the sources and writing the board",
  watching: "Setting up live monitoring",
};

const situationLabel: Record<string, string> = {
  developing: "Developing",
  ongoing: "Ongoing",
  contained: "Contained",
  recovering: "Recovering",
  resolved: "Resolved",
};

const FIRE_MAP_PADDING = { top: 208, right: 72, bottom: 72, left: 48 };

export function isBuilding(status: BoardStatus) {
  return status !== "live" && status !== "error";
}

/** Which widgets to draw. While building, every planned widget shows (as a skeleton until it has data). */
export function visibleWidgets(spec: BoardSpecV2 | null, data: BoardData | null, building: boolean): Widget[] {
  if (!spec) return [];
  const hidden = new Set(data?.hidden ?? []);
  return spec.widgets.filter((w) => {
    if (!widgetComponent(w.type)) return false;
    if (clientComputed.has(w.type)) return true;
    if (building) return true;
    return !hidden.has(w.id) && !!data?.widgets[w.id];
  });
}

export function Board(props: BoardProps) {
  const { spec, data, sources, events, status, tier, connected, lastPolledAt, onRefresh } = props;
  const byId = useMemo(() => new Map(
    (props.houthiBriefing ? [...sources, ...houthiContextSources] : sources).map((s) => [s.id, s]),
  ), [props.houthiBriefing, sources]);
  const [refreshing, setRefreshing] = useState(false);
  const [regionLabel, setRegionLabel] = useState<string>();
  const regions = props.workspace ? props.mapRegions ?? [] : [];
  const activeRegion = regions.find((region) => region.label === regionLabel) ?? regions[0];
  const building = isBuilding(status);
  const header = data?.header ?? null;
  const visible = visibleWidgets(spec, data, building);
  if (activeRegion && !visible.some((widget) => widget.type === "map")) {
    const configuredMap = spec?.widgets.find((widget) => widget.type === "map");
    if (configuredMap) visible.push(configuredMap);
  }
  const widgets: BoardEntry[] = visible.map((widget) => ({ key: widgetKeyOf(widget), widget }));
  const cyber = props.workspace && header?.crisisType === "cyberattack";
  const mapEntry = widgets.find(({ widget }) => widget.type === "map");
  const outage = props.workspace && header?.crisisType === "outage";
  const map = cyber || outage ? undefined : mapEntry;
  const timeline = map || props.workspace ? widgets.find(({ widget }) => widget.type === "timeline") : undefined;
  const timelineData = timeline ? data?.widgets[timeline.widget.id] as TimelineData | undefined : undefined;
  const briefingTimeline = useMemo(() => props.houthiBriefing ? houthiTimeline(timelineData) : undefined, [props.houthiBriefing, timelineData]);
  const changelog = widgets.find(({ widget }) => widget.type === "changelog");
  const sourcesWidget = widgets.find(({ widget }) => widget.type === "sources");
  const linkList = spec?.widgets.find((widget) => widget.type === "link-list");
  const linkData = linkList ? (data?.widgets[linkList.id] as LinkListData | undefined) : undefined;
  const releases = (linkData?.items ?? []).filter((item) => item?.kind === "official" && /^https?:\/\//.test(item.url));
  const mainWidgets = widgets.filter((entry) => {
    if (entry === mapEntry || entry === timeline || entry === changelog || entry === sourcesWidget) return false;
    if (entry.widget.type !== "link-list" || building) return true;
    const links = data?.widgets[entry.widget.id] as LinkListData | undefined;
    return !!links?.items?.some((item) => item && item.kind !== "official" && /^https?:\/\//.test(item.url));
  });
  const wildfire = props.workspace ? props.wildfire : undefined;
  const fire = useMemo(() => (wildfire ? wildfireView(spec, data, wildfire.timeZone) : null), [wildfire, spec, data]);
  const newestSource = useMemo(() => newest(sources.map((s) => s.publishedAt)), [sources]);
  const outlets = useMemo(() => outletsOf(sources), [sources]);
  const wire = useMemo(() => wireItems(sources), [sources]);
  const title = header?.title ?? props.title;
  const live = !building && connected && tier !== "paused";

  const legacy = props.specVersion < 2;

  const boardHeader = (
    <header className="fd-workspace-header flex min-w-0 shrink-0 items-center gap-2 border-b border-hairline">
      <Button href={`${SITE_URL}/`} variant="ghost" size="sm" iconOnly aria-label="Faraday home"
        className="shrink-0" leading={<LogoMark className="h-5 w-5" />} />
      <Heading as="h1" size="sm" className="fd-workspace-title min-w-0 flex-1 truncate" title={title ?? undefined}>
        {title ?? "Live board"}
      </Heading>
      {props.snapshotAt !== undefined && <Badge variant="outline">
        Snapshot · <time dateTime={new Date(props.snapshotAt).toISOString()}>{when(new Date(props.snapshotAt).toISOString())}</time>
      </Badge>}
      {!legacy && (onRefresh && status === "live" && tier !== "paused" || props.actions) ? (
        <div role="group" aria-label="Dashboard controls" className="flex shrink-0 items-center gap-1.5">
          {onRefresh && status === "live" && tier !== "paused" ? (
            <Tooltip content="Check the web now">
              <BoardHeaderButton icon="search" loading={refreshing} aria-label="Check the web now" onClick={() => void refresh()} />
            </Tooltip>
          ) : null}
          {props.actions}
        </div>
      ) : null}
      {props.workspaceNavigation}
    </header>
  );

  if (legacy) {
    const rebuilding = (
      <Card padding="lg" radius="xl" role="status" className="gap-4">
        <Caption>Rebuilding this board</Caption>
        {!props.workspace && <Display as="h1" size="md">{title ?? "Live board"}</Display>}
        <Text tone="subtle" className="max-w-2xl">
          This board was made with an earlier version of Faraday and is being rebuilt from its prompt with the new pipeline. It
          will appear here on its own when it is ready.
        </Text>
        <Text size="sm" tone="muted">
          “{props.prompt}”
        </Text>
      </Card>
    );
    return props.workspace ? (
      <div className="fd-workspace-board">
        {boardHeader}
        <div className="min-h-0 overflow-auto">{rebuilding}</div>
      </div>
    ) : rebuilding;
  }

  async function refresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (e) {
      toast.danger("Could not check the web", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }

  function renderContent(entry: BoardEntry, compact: boolean, fillMap = false) {
    const Comp = widgetComponent(entry.widget.type)!;
    return (
      <Comp
        widget={entry.widget}
        data={data?.widgets[entry.widget.id] as never}
        sources={byId}
        allSources={sources}
        events={events}
        status={status}
        tier={tier}
        building={building}
        mapFocus={compact && (props.snapshotAt === undefined || entry.widget.type !== "link-list")}
        fillMap={fillMap}
        wrapSourceTitles={!!props.wildfire}
        collapseSourceGroups={!!props.wildfire || cyber || props.houthiBriefing}
        compactTrendAxis={!!props.wildfire && compact}
        cyberPresentation={cyber}
        outagePresentation={outage}
      />
    );
  }

  function renderWorkspaceWidget(entry: BoardEntry, hideTitle = false) {
    const widget = entry.widget;
    return (
      <section key={entry.key} aria-label={widget.title} data-widget={widget.id} className="@container fd-workspace-widget">
        {!hideTitle && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold">{widget.title}</h3>
          </div>
        )}
        <WidgetBoundary resetKey={data?.widgets[widget.id]}>{renderContent(entry, true)}</WidgetBoundary>
      </section>
    );
  }

  const lastCheckedAt = lastPolledAt == null ? null : new Date(lastPolledAt).toISOString();
  const lastChecked = props.snapshotAt === undefined && lastCheckedAt && (
    <span>Last checked <time dateTime={lastCheckedAt}>{when(lastCheckedAt)}</time></span>
  );
  const conciseSummary = props.workspace && (!!map || props.houthiBriefing);
  const headline = header?.headline;
  const summaryText = headline?.text || header?.subtitle;
  const summary = (
    <div className={conciseSummary ? "grid min-w-0 gap-2" : "grid min-w-0 gap-3"}>
      {headline?.text ? (
        <Text size="sm">{headline.text} <SourceChips ids={headline.sources} sources={byId} /></Text>
      ) : summaryText ? <Text size="sm" tone="muted">{summaryText}</Text> : null}
      <Text as="div" size="sm" tone="muted" className="flex flex-wrap gap-x-3 gap-y-1">
        {!conciseSummary && header?.crisisType ? <span>{header.crisisType}</span> : null}
        {newestSource && (!conciseSummary || !lastPolledAt) ? <span>Newest source <Ago t={newestSource} /></span> : null}
        {!conciseSummary && header?.asOf ? <span>Latest figure <Ago t={header.asOf} /></span> : null}
        {lastChecked}
        {building && props.workspace && <span role="status">{props.stage ?? stageText[status] ?? "Working"}</span>}
        {!building && !conciseSummary && tier === "paused" && <span>Updates paused</span>}
      </Text>
      {typeof header?.severity === "number" && (
        <Meter label="Severity" value={Math.min(5, Math.max(0, header.severity))} min={0} max={5}
          low={2} high={4} optimum={0} size="sm"
          formatOptions={{ style: "decimal", maximumFractionDigits: 1 }} getValueLabel={(v) => `${v} of 5`} />
      )}
    </div>
  );

  if (props.workspace && props.houthiBriefing) {
    const strikeEntry = widgets.find(({ key }) => key === "table:strikes-infrastructure-log");
    const narrativeEntry = widgets.find(({ widget }) => widget.type === "narrative");
    const figures = widgets.find(({ widget }) => widget.type === "stat-grid");
    const otherLinks = mainWidgets.find(({ widget }) => widget.type === "link-list");
    const strikes = strikeEntry ? data?.widgets[strikeEntry.widget.id] as TableData | undefined : undefined;
    return (
      <OfficialReleasesContext.Provider value={releases}>
        <div className="fd-workspace-board">
          {boardHeader}
          <HouthiReplay key={props.workspaceKey}
            workspaceKey={props.workspaceKey}
            timeline={briefingTimeline}
            strikes={strikes}
            map={mapEntry ? data?.widgets[mapEntry.widget.id] as MapData | undefined : undefined}
            sources={byId}
            timelineCard={timeline && (
              <Card title="Timeline" headingLevel={2} radius="lg" collapsible defaultOpen={props.defaultTimelineOpen ?? true}>
                <div className="fd-houthi-timeline-body" role="region" aria-label="Incident timeline" tabIndex={0}>
                  <WidgetBoundary resetKey={briefingTimeline}>
                    <TimelineWidget widget={{ ...timeline.widget, type: "timeline", display: "list" }} data={briefingTimeline}
                      sources={byId} allSources={sources} events={events} status={status} tier={tier} building={building} />
                  </WidgetBoundary>
                </div>
              </Card>
            )}
            rightCards={(cardWidth) => <HouthiCards strikes={strikes} sources={byId} workspaceKey={props.workspaceKey} cardWidth={cardWidth}
              summary={<>
                {narrativeEntry ? renderWorkspaceWidget(narrativeEntry, true) : summary}
                {figures && <details>
                  <summary className="my-2 cursor-pointer text-sm">Reported casualties &amp; interceptions</summary>
                  {renderWorkspaceWidget(figures, true)}
                </details>}
              </>}
              evidence={<>
                {props.boardId && <ContextEvidence boardId={props.boardId} checkedAt={lastPolledAt} />}
                <details>
                  <summary className="my-2 cursor-pointer text-sm">Sources &amp; official links</summary>
                  <Text as="div" size="sm" className="mb-2">
                    Additional timeline reporting{" "}
                    <SourceChips ids={houthiContextSources.map(({ id }) => id)} sources={byId} />
                  </Text>
                  {releases.length > 0 && <OfficialReleases releases={releases} />}
                  {otherLinks && renderWorkspaceWidget(otherLinks, true)}
                  {sourcesWidget && renderWorkspaceWidget(sourcesWidget, true)}
                </details>
              </>}
            />}
          />
        </div>
      </OfficialReleasesContext.Provider>
    );
  }

  function cardEntry(content: BoardCardContent) {
    if (content.kind === "automatic-chart") return automaticChartEntry(widgets, data);
    if (content.kind !== "widget" && content.kind !== "status-chart") return;
    const type = content.kind === "widget" ? content.type : "table";
    return widgets.find((entry) => {
      if (entry.widget.type !== type || (content.key && content.key !== entry.key)) return false;
      if (content.kind === "widget") return true;
      const table = data?.widgets[entry.widget.id] as TableData | undefined;
      return table?.columns?.some((column) => column.kind === "status");
    });
  }

  function renderCardContents(contents: BoardCardContent[]) {
    const sections = contents.flatMap((content) => {
      if (content.kind === "summary") return [summary];
      if (content.kind === "incident-status" || content.kind === "official-tally") return [
        <IncidentReports kind={content.kind} chart={content.kind === "official-tally" ? content.chart : undefined}
          widgets={spec?.widgets ?? []} data={data} sources={byId} areas={activeRegion?.areas ?? []} />,
      ];
      const entry = cardEntry(content);
      if (!entry && content.kind === "automatic-chart") {
        return [<Text size="sm" tone="muted">Waiting for dated observations or reported statuses.</Text>];
      }
      if (!entry || (props.workspace && entry === map)) return [];
      if (content.kind === "automatic-chart" && entry.widget.type === "table") {
        return [<StatusBreakdown entry={entry} data={data} chart="auto" />];
      }
      return [content.kind === "status-chart"
        ? <StatusBreakdown entry={entry} data={data} chart={content.chart} fallback={renderWorkspaceWidget(entry)} />
        : renderWorkspaceWidget(entry)];
    });
    return (
      <div className="fd-configured-card-content">
        {sections.map((section, index) => <div key={index} className="min-w-0">{section}</div>)}
        {!sections.length && <Text size="sm" tone="muted">No content available yet.</Text>}
      </div>
    );
  }
  const configuredCards = props.configuredCards?.map((card) => ({ ...card, content: renderCardContents(card.contents) }));
  const cardIncludes = (entry: BoardEntry) =>
    [...(props.configuredCards ?? []), ...(props.sidebarSettings ? [props.sidebarSettings] : []), ...(props.mapCard ? [props.mapCard] : [])]
      .some(({ contents }) => contents.some((content) => content.kind !== "summary" && cardEntry(content) === entry));

  if (props.workspace) {
    const sidebar = props.sidebarSettings;
    const leftPanel = sidebar ? {
      title: sidebar.title, defaultOpen: sidebar.open, content: renderCardContents(sidebar.contents),
    } : fire && sidebar === undefined && timeline ? {
      title: "Fire log", ariaLabel: "Incident timeline", defaultOpen: props.defaultTimelineOpen,
      content: <FireLog view={fire} sources={byId} />,
    } : sidebar === undefined && timeline && !cardIncludes(timeline) ? {
      title: "Timeline", ariaLabel: "Incident timeline", defaultOpen: props.defaultTimelineOpen,
      content: props.strikeOverview ? <>
        <StrikeDayChart timeline={data?.widgets[timeline.widget.id] as TimelineData | undefined} />
        {renderWorkspaceWidget(timeline, true)}
      </> : renderWorkspaceWidget(timeline, true),
    } : undefined;
    const featured = mainWidgets.filter((entry) => entry.widget.type === "stat-grid" || entry.widget.type === "status-grid");
    const sections = mainWidgets.filter((entry) => !featured.includes(entry));
    const overviewChart = props.overviewStatusChart && sections.find((entry) => entry.key === props.overviewStatusChart);
    const figureSections = map ? featured.filter((entry) => entry.widget.type === "stat-grid" && !cardIncludes(entry)) : [];
    const figureItems = figureSections.flatMap((entry) => {
      const figures = data?.widgets[entry.widget.id] as StatGridData | undefined;
      return getStatItems(figures);
    });
    const hasDatedFigures = figureItems.some((item) => item.asOf || item.history?.length);
    const restrictionFigure = figureSections.length > 0 && !hasDatedFigures && latestRestrictionFigure(
      sections.flatMap((entry) => {
        const table = data?.widgets[entry.widget.id] as TableData | undefined;
        return entry.widget.type === "table" && table?.columns?.length && table.rows?.length ? [table] : [];
      }),
      byId,
    );
    // Short labels keep the three cards on one line each, at every width.
    const fireFigures = fire ? ([["containment", "Contained"], ["area", "Area burned"], ["evacuated", "Evacuated"]] as const)
      .flatMap(([name, label]) => {
        const item = fire.figures[name];
        return item ? [{ ...item, label, unit: name === "evacuated" ? null : item.unit }] : [];
      }) : [];
    const mapFigures = fireFigures.length ? fireFigures
      : restrictionFigure ? [restrictionFigure] : selectMapFigures(figureItems, summaryText ?? undefined);
    const overviewFigures = featured.filter((entry) => !figureSections.includes(entry));
    const mapData = (map && data?.widgets[map.widget.id]) as MapData | undefined;
    const cyberMap = (cyber || outage) && mapEntry ? (data?.widgets[mapEntry.widget.id]) as MapData | undefined : undefined;
    const dataSections = cyber || outage
      ? [...mainWidgets, ...(cyber && mapEntry && cyberMap?.points?.length ? [mapEntry] : [])]
      : [...sections, ...figureSections];
    const cyberDetails = cyber ? sections.find(({ widget }) => widget.type === "narrative") : undefined;
    const outageProps: OutageProps = {
      headline: header?.headline, sources: byId, checkedAt: lastCheckedAt, map: cyberMap,
      metrics: featured.flatMap(e => e.widget.type === "stat-grid" ? getStatItems(data?.widgets[e.widget.id] as StatGridData | undefined) : []),
      services: featured.flatMap(e => e.widget.type === "status-grid" ? (data?.widgets[e.widget.id] as StatusGridData | undefined)?.items ?? [] : []),
      tables: sections.flatMap(e => e.widget.type === "table" && data?.widgets[e.widget.id] ? [{ title: e.widget.title, data: data.widgets[e.widget.id] as TableData }] : []),
      resources: spec?.widgets.flatMap(w => w.type === "link-list" ? (data?.widgets[w.id] as LinkListData | undefined)?.items ?? [] : []) ?? [],
      advisories: sections.flatMap(e => e.widget.type === "alert-list" ? (data?.widgets[e.widget.id] as AlertListData | undefined)?.items ?? [] : []),
    };
    const outageOverview = outage ? <OutageOverview {...outageProps} renderMap={(selectedMap, focused) => mapEntry ? (
      <WidgetBoundary resetKey={selectedMap}><MapWidget key={focused ? selectedMap.center?.name : "all"}
        widget={{ ...mapEntry.widget, type: "map" }} data={selectedMap} sources={byId} allSources={sources}
        events={events} status={status} tier={tier} building={building} fillMap fixedCamera={focused} /></WidgetBoundary>
    ) : null} /> : undefined;
    const cyberOverview = cyber ? (
      <CyberIncidentOverview
        headline={header?.headline}
        metrics={featured.flatMap((entry) => entry.widget.type === "stat-grid"
          ? getStatItems((data?.widgets[entry.widget.id]) as StatGridData | undefined)
          : [])}
        services={featured.flatMap((entry) => entry.widget.type === "status-grid"
          ? ((data?.widgets[entry.widget.id]) as StatusGridData | undefined)?.items ?? []
          : [])}
        advisories={sections.flatMap((entry) => entry.widget.type === "alert-list"
          ? ((data?.widgets[entry.widget.id]) as AlertListData | undefined)?.items ?? []
          : [])}
        tables={sections.flatMap(entry => {
          if (entry.widget.type !== "table") return [];
          const table = (data?.widgets[entry.widget.id]) as TableData | undefined;
          return table ? [table] : [];
        })}
        trends={sections.flatMap(entry => {
          if (entry.widget.type !== "trend") return [];
          const trend = (data?.widgets[entry.widget.id]) as TrendData | undefined;
          return trend ? [trend] : [];
        })}
        resources={releases}
        timeline={timeline ? (data?.widgets[timeline.widget.id]) as TimelineData | undefined : undefined}
        sources={byId}
        lastChecked={lastCheckedAt}
      />
    ) : undefined;
    return (
      <OfficialReleasesContext.Provider value={releases}>
        <div className={`@container fd-workspace-board${props.wildfire ? " fd-wildfire-workspace" : ""}${props.strikeOverview ? " fd-strike-workspace" : ""}${outage ? " fd-outage-workspace" : ""}`}>
          {boardHeader}
          <BoardWorkspace key={props.workspaceKey} workspaceKey={props.workspaceKey} cardsOnMap={props.cardsOnMap} flowingDetails={!!props.wildfire}
            main={outageOverview ?? cyberOverview}
            defaultEvidenceOpen={props.defaultEvidenceOpen}
            showSavedSources={props.snapshotAt !== undefined}
            configuredCards={configuredCards?.map((card) => ({
              id: `card:${card.id}`, label: card.title, content: card.content, open: card.open,
            }))}
            map={map ? <>
              <WidgetBoundary resetKey={mapData}>
                {activeRegion ? (
                  <MapWidget key={activeRegion.label} widget={{ ...map.widget, type: "map" }}
                    data={{ points: mapData?.points ?? [], center: { ...activeRegion, name: activeRegion.label } }}
                    sources={byId} allSources={sources} events={events} status={status} tier={tier} building={building} fillMap fixedCamera />
                ) : fire ? (
                  // The figure cards sit over the top of the map, so the fitted places keep clear of them.
                  <MapWidget widget={{ ...map.widget, type: "map" }} data={mapData}
                    sources={byId} allSources={sources} events={events} status={status} tier={tier} building={building}
                    fillMap fitPadding={FIRE_MAP_PADDING} />
                ) : renderContent(map, true, true)}
              </WidgetBoundary>
              {(props.mapCard || regions.length > 1) && <div className="fd-board-map-overlay">
                {props.mapCard && <Card title={props.mapCard.title} headingLevel={2} padding="sm" radius="lg">
                  {renderCardContents(props.mapCard.contents)}
                </Card>}
                {activeRegion && regions.length > 1 && <RegionSwitch regions={regions} selected={activeRegion.label} onChange={setRegionLabel} />}
              </div>}
              {activeRegion?.inset && <RegionInset key={activeRegion.label} inset={activeRegion.inset} points={mapData?.points ?? []} />}
            </> : undefined}
            mapFigures={props.strikeOverview ? <StrikeMapFigures widgets={spec?.widgets ?? []} data={data} />
              : !props.mapCard && regions.length < 2 && mapFigures.length ? <MapFigureCards items={mapFigures} sources={byId} /> : undefined}
            sidebar={leftPanel}
            overview={outage ? <OutageSituation {...outageProps} /> : cyber ? (cyberDetails ? <>
              <h3 className="text-sm font-semibold">Incident summary</h3>
              {lastChecked && <Text size="sm" tone="muted">{lastChecked}</Text>}
              {header?.headline && <Text size="sm">{header.headline.text}</Text>}
              <details className="min-w-0 rounded-md border border-hairline p-2">
                <summary className="cursor-pointer text-sm font-medium">Background &amp; reports</summary>
                <div className="mt-2">{renderWorkspaceWidget(cyberDetails, true)}</div>
              </details>
            </> : summary) : fire ? <>
              <WildfireOverview view={fire} header={header} sources={byId} releases={releases} lastChecked={lastChecked || undefined} />
              {status === "error" && !widgets.length ? <EmptyState title="The board could not be built" description={events.find((e) => e.kind === "error")?.message} /> : null}
            </> : props.strikeOverview ? (
              <StrikeOverview widgets={spec?.widgets ?? []} data={data} sources={byId} summary={summary}
                status={header?.status ? situationLabel[header.status] ?? header.status : null} />
            ) : <>
              {summary}
              {overviewChart && <StatusBreakdown entry={overviewChart} data={data} fallback={renderWorkspaceWidget(overviewChart)} />}
              {props.incidentOverview?.status && <IncidentReports kind="incident-status" hideEmpty
                widgets={spec?.widgets ?? []} data={data} sources={byId} areas={activeRegion?.areas ?? []} />}
              {props.incidentOverview?.tally && <IncidentReports kind="official-tally" chart="auto" hideEmpty
                widgets={spec?.widgets ?? []} data={data} sources={byId} areas={activeRegion?.areas ?? []} />}
              {overviewFigures.map((entry) => renderWorkspaceWidget(entry))}
              {status === "error" && !widgets.length ? <EmptyState title="The board could not be built" description={events.find((e) => e.kind === "error")?.message} /> : null}
            </>}
            sections={dataSections.map((entry) => ({
              key: entry.key,
              title: entry.widget.type === "stat-grid" ? "Figures and sources" : entry.widget.title,
              showsMapFigures: entry.widget.type === "stat-grid",
              content: renderWorkspaceWidget(entry, true),
            }))}
            sources={sourcesWidget || releases.length ? <>
              {!props.wildfire && <SourceWire items={wire} />}
              {sourcesWidget && renderWorkspaceWidget(sourcesWidget, true)}
              {!sourcesWidget && <OfficialReleases releases={releases} />}
            </> : undefined}
            sourceCount={sources.length}
            changes={changelog ? renderWorkspaceWidget(changelog, true) : undefined}
            contextEvidence={props.boardId ? <ContextEvidence boardId={props.boardId} checkedAt={lastPolledAt} /> : undefined}
          />
        </div>
      </OfficialReleasesContext.Provider>
    );
  }

  return (
    <OfficialReleasesContext.Provider value={releases}>
      <div className="flex flex-col gap-4">
        <header>
          <Card padding="lg" radius="xl" className="gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={building ? "accent" : live ? "success" : connected ? "neutral" : "warning"} pulse={live || building}>
              {building ? "Building" : tier === "paused" ? "Paused" : connected ? "Live" : "Offline"}
            </Badge>
            {header?.status ? <Badge variant="outline">{situationLabel[header.status] ?? header.status}</Badge> : null}
            {header?.crisisType ? (
              <Badge variant="outline" mono>
                {header.crisisType}
              </Badge>
            ) : null}
          </div>

          {title ? (
            <Display as="h1" size="md">
              {title}
            </Display>
          ) : (
            <Display as="h1" size="md">
              <span className="sr-only">Live board</span>
              <Skeleton inline width="12ch" />
            </Display>
          )}
          {header?.subtitle ? <Text tone="muted">{header.subtitle}</Text> : null}

          {header?.headline?.text ? (
            <Text size="lg" tone="subtle" className="max-w-4xl">
              {header.headline.text} <SourceChips ids={header.headline.sources} sources={byId} />
            </Text>
          ) : building ? (
            <>
              <Text size="lg" tone="subtle" className="max-w-4xl" aria-hidden="true">
                <Skeleton inline width="min(100%, 48ch)" />
              </Text>
              <Text size="sm" tone="muted" role="status">
                {props.stage ?? stageText[status] ?? "Working"}
                {status === "composing" ? `, ${sources.length} sources so far. Sections appear as they are filled.` : "…"}
              </Text>
            </>
          ) : null}

          {props.actions ? <div className="flex flex-wrap items-center gap-2">{props.actions}</div> : null}

          <Separator />
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            {typeof header?.severity === "number" ? (
              <div className="w-56 max-w-full">
                <Meter
                  label="Severity"
                  value={Math.min(5, Math.max(0, header.severity))}
                  min={0}
                  max={5}
                  low={2}
                  high={4}
                  optimum={0}
                  size="sm"
                  formatOptions={{ style: "decimal", maximumFractionDigits: 1 }}
                  getValueLabel={(v) => `${v} of 5`}
                />
              </div>
            ) : null}
            <Text as="div" size="sm" tone="muted" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-2">
                <SourceStack outlets={outlets} max={6} />
                <span>
                  {sources.length} sources read{outlets.length > 1 ? ` from ${outlets.length} outlets` : ""}
                </span>
              </span>
              {newestSource ? (
                <span>
                  newest <Ago t={newestSource} />
                </span>
              ) : null}
              {header?.asOf ? (
                <span>
                  latest figure <Ago t={header.asOf} />
                </span>
              ) : null}
              {lastChecked}
              {!building && tier === "paused" && <span>Updates paused</span>}
            </Text>
            {onRefresh && status === "live" && tier !== "paused" ? (
              <div className="@2xl:ml-auto">
                <Tooltip content="Searches the news and runs the monitors now" type="description">
                  <Button variant="outline" size="sm" loading={refreshing} onClick={() => void refresh()}>
                    Check the web now
                  </Button>
                </Tooltip>
              </div>
            ) : null}
          </div>
          </Card>
        </header>

        <SourceWire items={wire} />

        {configuredCards ? (
          <DashboardGrid aria-label={`${title ?? "Board"} sections`} minTileWidth={420}>
            {configuredCards.map((card) => (
              <WidgetFrame key={card.id} id={`card-${card.id}`} title={card.title} span={card.placement === "full" ? "full" : "half"} resetKey={data}>
                {card.content}
              </WidgetFrame>
            ))}
          </DashboardGrid>
        ) : widgets.length ? (
          <DashboardGrid aria-label={`${title ?? "Board"} sections`} minTileWidth={420}>
            {widgets.map((lw) => {
              const w = lw.widget;
              const d = data?.widgets[w.id];
              // Keyed by the stable widget key, so a moved map or chart is not remounted.
              return (
                <WidgetFrame
                  key={lw.key}
                  id={w.id}
                  title={w.title}
                  span={w.span}
                  resetKey={d}
                  updatedAt={props.updatedAt?.[w.id]}
                >
                  {renderContent(lw, false)}
                </WidgetFrame>
              );
            })}
          </DashboardGrid>
        ) : building ? (
          <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2" aria-busy="true">
            <Skeleton height={160} radius="lg" className="@4xl:col-span-2" />
            <Skeleton height={224} radius="lg" />
            <Skeleton height={224} radius="lg" />
          </div>
        ) : status === "error" ? (
          <Card padding="md" role="alert">
            <EmptyState
              title="The board could not be built"
              description={events.find((e) => e.kind === "error")?.message ?? "The pipeline stopped before the board was ready."}
              headingLevel={2}
            />
          </Card>
        ) : null}
      </div>
    </OfficialReleasesContext.Provider>
  );
}
