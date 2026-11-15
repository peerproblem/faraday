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
import { applyLayout, type LaidOutWidget } from "@/lib/client/apply-layout";
import { transitionName } from "@/lib/client/view-transition";
import { SITE_URL } from "@/lib/config";
import type { BoardCardContent, BoardCardSettings, BoardData, BoardEvent, BoardLayoutCard, BoardSpecV2, BoardStatus, BoardTier, LinkListData, PersonalLayout, NarrativeData, Source, StatGridData, TableData, Widget } from "@/lib/spec";
import { newest, when } from "@/lib/time";
import { BoardHeaderButton } from "./header-button";
import { ContextEvidence } from "./context-evidence";
import { latestRestrictionFigure, selectMapFigures } from "./map-figures";
import { BoardWorkspace } from "./workspace";
import { StatusBreakdown } from "./status-breakdown";

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
  onRefresh?: () => Promise<unknown>;
  /** A personal dashboard's layout over this baseline. Null or absent draws the baseline as it is. */
  layout?: PersonalLayout | null;
  /** Baseline version on screen, for the New badge of a personal layout. */
  version?: number;
  /** Give every widget a view-transition-name, so layout changes animate (personal dashboards only). */
  animate?: boolean;
  /** When the stream last changed each widget's data, by widget id. */
  updatedAt?: Record<string, number>;
  /** Extra controls in the header (for example "Add to my dashboard"). */
  actions?: ReactNode;
  /** Edit-mode controls for one widget. */
  tools?: (w: LaidOutWidget) => ReactNode;
  workspace?: boolean;
  cardsOnMap?: boolean;
  defaultTimelineOpen?: boolean;
  defaultEvidenceOpen?: boolean;
  wildfireOverview?: boolean;
  workspaceNavigation?: ReactNode;
  workspaceKey?: string;
  workspaceEditor?: ReactNode;
  sidebarSettings?: BoardCardSettings | null;
  configuredCards?: BoardLayoutCard[];
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
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const [refreshing, setRefreshing] = useState(false);
  const building = isBuilding(status);
  const header = data?.header ?? null;
  const visible = visibleWidgets(spec, data, building);
  const laid = applyLayout({ version: 2, widgets: visible }, data, props.layout ?? null, { version: props.version });
  const widgets = laid.widgets;
  const map = widgets.find(({ widget }) => widget.type === "map");
  const timeline = map || props.workspace ? widgets.find(({ widget }) => widget.type === "timeline") : undefined;
  const changelog = widgets.find(({ widget }) => widget.type === "changelog");
  const sourcesWidget = widgets.find(({ widget }) => widget.type === "sources");
  const linkList = spec?.widgets.find((widget) => widget.type === "link-list");
  const linkData = linkList ? (data?.widgets[linkList.id] as LinkListData | undefined) : undefined;
  const releases = (linkData?.items ?? []).filter((item) => item?.kind === "official" && /^https?:\/\//.test(item.url));
  const mainWidgets = widgets.filter((entry) => {
    if (entry === map || entry === timeline || entry === changelog || entry === sourcesWidget) return false;
    if (entry.widget.type !== "link-list" || building) return true;
    const links = data?.widgets[entry.widget.id] as LinkListData | undefined;
    return !!links?.items?.some((item) => item && item.kind !== "official" && /^https?:\/\//.test(item.url));
  });
  const compact = laid.compactHeader;
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

  function renderContent(entry: LaidOutWidget, compact: boolean, fillMap = false) {
    const Comp = widgetComponent(entry.widget.type)!;
    return (
      <Comp
        widget={props.wildfireOverview && entry.widget.type === "timeline"
          ? { ...entry.widget, display: "story" }
          : entry.widget}
        data={(entry.data ?? data?.widgets[entry.widget.id]) as never}
        filter={entry.filter as never}
        sources={byId}
        allSources={sources}
        events={events}
        status={status}
        tier={tier}
        building={building}
        mapFocus={compact}
        fillMap={fillMap}
        wrapSourceTitles={props.wildfireOverview}
        collapseSourceGroups={props.wildfireOverview}
        compactTrendAxis={props.wildfireOverview && compact}
      />
    );
  }

  function renderWorkspaceWidget(entry: LaidOutWidget, hideTitle = false) {
    const widget = entry.widget;
    const tools = props.tools?.(entry);
    return (
      <section key={entry.key} aria-label={widget.title} data-widget={widget.id} className="@container fd-workspace-widget">
        {(!hideTitle || tools) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!hideTitle && <h3 className="min-w-0 flex-1 text-sm font-semibold">{widget.title}</h3>}
            {tools && <div className="ml-auto flex flex-wrap items-center gap-1">{tools}</div>}
          </div>
        )}
        <WidgetBoundary resetKey={entry.data ?? data?.widgets[widget.id]}>{renderContent(entry, true)}</WidgetBoundary>
      </section>
    );
  }

  const lastCheckedAt = lastPolledAt == null ? null : new Date(lastPolledAt).toISOString();
  const lastChecked = lastCheckedAt && (
    <span>Last checked <time dateTime={lastCheckedAt}>{when(lastCheckedAt)}</time></span>
  );
  const conciseSummary = props.workspace && !!map;
  const headline = compact ? undefined : header?.headline;
  const summaryText = compact ? undefined : headline?.text || header?.subtitle;
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

  function cardEntry(content: Exclude<BoardCardContent, { kind: "summary" }>) {
    const type = content.kind === "widget" ? content.type : "table";
    return widgets.find((entry) => {
      if (entry.widget.type !== type || (content.key && content.key !== entry.key)) return false;
      if (content.kind === "widget") return true;
      const table = (entry.data ?? data?.widgets[entry.widget.id]) as TableData | undefined;
      return table?.columns?.some((column) => column.kind === "status");
    });
  }

  function renderCardContents(contents: BoardCardContent[]) {
    const sections = contents.flatMap((content) => {
      if (content.kind === "summary") return [summary];
      const entry = cardEntry(content);
      if (!entry || (props.workspace && entry === map)) return [];
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
  const cardIncludes = (entry: LaidOutWidget) =>
    [...(props.configuredCards ?? []), ...(props.sidebarSettings ? [props.sidebarSettings] : [])]
      .some(({ contents }) => contents.some((content) => content.kind !== "summary" && cardEntry(content) === entry));

  if (props.workspace) {
    const sidebar = props.sidebarSettings;
    const leftPanel = sidebar ? {
      title: sidebar.title, defaultOpen: sidebar.open, content: renderCardContents(sidebar.contents),
    } : sidebar === undefined && timeline && !cardIncludes(timeline) ? {
      title: "Timeline", ariaLabel: "Incident timeline", defaultOpen: props.defaultTimelineOpen,
      content: renderWorkspaceWidget(timeline, true),
    } : undefined;
    const featured = mainWidgets.filter((entry) => entry.widget.type === "stat-grid" || entry.widget.type === "status-grid");
    const sections = mainWidgets.filter((entry) => !featured.includes(entry));
    const chart = props.layout?.overviewChart;
    const chartEntry = chart?.type === "donut" ? sections.find((entry) => entry.key === chart.widget) : undefined;
    const figureSections = map ? featured.filter((entry) => entry.widget.type === "stat-grid" && !cardIncludes(entry)) : [];
    const figureItems = figureSections.flatMap((entry) => {
      const figures = (entry.data ?? data?.widgets[entry.widget.id]) as StatGridData | undefined;
      const metrics = entry.filter?.kind === "stat-grid" ? entry.filter.metrics : undefined;
      return getStatItems(figures, metrics);
    });
    const hasDatedFigures = figureItems.some((item) => item.asOf || item.history?.length);
    const restrictionFigure = figureSections.length > 0 && !hasDatedFigures && latestRestrictionFigure(
      sections.flatMap((entry) => {
        const table = (entry.data ?? data?.widgets[entry.widget.id]) as TableData | undefined;
        return entry.widget.type === "table" && table?.columns?.length && table.rows?.length ? [table] : [];
      }),
      byId,
    );
    const mapFigures = restrictionFigure ? [restrictionFigure] : selectMapFigures(figureItems, summaryText ?? undefined);
    const overviewFigures = featured.filter((entry) => !figureSections.includes(entry));
    const mapTools = map && props.tools?.(map);
    const narrative = props.wildfireOverview ? sections.find(({ widget }) => widget.type === "narrative") : undefined;
    const narrativeData = (narrative && (narrative.data ?? data?.widgets[narrative.widget.id])) as NarrativeData | undefined;
    const evacuation = narrativeData?.sentences.find((sentence) => /evacuation orders? (?:were |was )?lifted/i.test(sentence?.text ?? ""));
    const housing = props.wildfireOverview ? figureItems.filter((item) => /homes-(?:destroyed|damaged)$/.test(item.key)) : [];
    return (
      <OfficialReleasesContext.Provider value={releases}>
        <div className={`@container fd-workspace-board${props.wildfireOverview ? " fd-wildfire-workspace" : ""}`}>
          {boardHeader}
          <BoardWorkspace key={props.workspaceKey} workspaceKey={props.workspaceKey} cardsOnMap={props.cardsOnMap} flowingDetails={props.wildfireOverview}
            defaultEvidenceOpen={props.defaultEvidenceOpen}
            configuredCards={configuredCards?.map((card) => ({
              id: `card:${card.id}`, label: card.title, content: card.content, open: card.open,
            }))}
            map={map ? <>
              <WidgetBoundary resetKey={map.data ?? data?.widgets[map.widget.id]}>{renderContent(map, true, true)}</WidgetBoundary>
              {mapTools ? <div className="fd-workspace-map-tools">{mapTools}</div> : null}
            </> : undefined}
            mapFigures={mapFigures.length ? <MapFigureCards items={mapFigures} sources={byId} /> : undefined}
            sidebar={leftPanel}
            overview={<>
              {evacuation && (
                <section className="grid gap-1.5" aria-label="Evacuation and access">
                  <h3 className="text-base font-semibold">Evacuation &amp; access</h3>
                  <Text size="sm">{evacuation.text} <SourceChips ids={evacuation.sources} sources={byId} collapseAt={5} /></Text>
                </section>
              )}
              {housing.length > 0 && (
                <section className="grid gap-1.5 border-t border-hairline pt-3" aria-label="Housing damage">
                  <h3 className="text-base font-semibold">Housing damage</h3>
                  <div className="grid gap-1.5">
                    {housing.map((item) => (
                      <Text key={item.key} size="sm">
                        <strong>{item.valueText}{item.unit && ` ${item.unit}`}</strong> {item.label.replace(/^homes\s+/i, "").toLowerCase()}{" "}
                        <SourceChips ids={item.sources} sources={byId} evidence={item.evidence} />
                      </Text>
                    ))}
                  </div>
                </section>
              )}
              {summary}
              {chartEntry && <StatusBreakdown entry={chartEntry} data={data} />}
              {overviewFigures.map((entry) => renderWorkspaceWidget(entry))}
              {props.wildfireOverview && releases.length > 0 && (
                <details className="border-t border-hairline pt-3">
                  <summary className="cursor-pointer text-sm font-medium">Official releases</summary>
                  <div className="mt-2"><OfficialReleases releases={releases} /></div>
                </details>
              )}
              {status === "error" && !widgets.length ? <EmptyState title="The board could not be built" description={events.find((e) => e.kind === "error")?.message} /> : null}
            </>}
            sections={[...sections, ...figureSections].map((entry) => ({
              key: entry.key,
              title: entry.widget.type === "stat-grid" ? "Figures and sources" : entry.widget.title,
              showsMapFigures: entry.widget.type === "stat-grid",
              content: renderWorkspaceWidget(entry, true),
            }))}
            sources={sourcesWidget || releases.length ? <>
              {!props.wildfireOverview && <SourceWire items={wire} />}
              {sourcesWidget && renderWorkspaceWidget(sourcesWidget, true)}
              {!sourcesWidget && <OfficialReleases releases={releases} />}
            </> : undefined}
            sourceCount={sources.length}
            changes={changelog ? renderWorkspaceWidget(changelog, true) : undefined}
            contextEvidence={props.boardId ? <ContextEvidence boardId={props.boardId} checkedAt={lastPolledAt} /> : undefined}
            editor={props.workspaceEditor}
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
          {header?.subtitle && !compact ? <Text tone="muted">{header.subtitle}</Text> : null}

          {compact ? null : header?.headline?.text ? (
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

        {compact ? null : <SourceWire items={wire} />}

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
              const d = lw.data ?? data?.widgets[w.id];
              // Keyed by the stable widget key, so a moved map or chart is not remounted.
              return (
                <WidgetFrame
                  key={lw.key}
                  id={w.id}
                  title={w.title}
                  span={w.span}
                  resetKey={d}
                  transitionName={props.animate ? transitionName(lw.key) : undefined}
                  updatedAt={lw.extra ? undefined : props.updatedAt?.[w.id]}
                  isNew={lw.isNew}
                  tools={props.tools?.(lw)}
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
