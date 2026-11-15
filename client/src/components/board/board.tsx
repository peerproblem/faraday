"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardGrid } from "@/components/ui/dashboard";
import { Menu, MenuContent, MenuTrigger } from "@/components/ui/menu";
import { Icon } from "@/components/ui/icon";
import { Meter } from "@/components/ui/meter";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Caption, Display, Heading, Text } from "@/components/ui/typography";
import { Separator } from "@/components/ui/separator";
import { SourceStack } from "@/components/sources/source-mark";
import { SourceWire } from "@/components/sources/source-wire";
import { clientComputed, widgetComponent } from "@/components/widgets/registry";
import { SourceChips } from "@/components/widgets/source-chips";
import { getStatItems, MapFigureCards } from "@/components/widgets/stat-grid";
import { WidgetBoundary, WidgetFrame } from "@/components/widgets/widget-frame";
import { applyLayout, type LaidOutWidget } from "@/lib/client/apply-layout";
import { transitionName } from "@/lib/client/view-transition";
import type { BoardData, BoardEvent, BoardSpecV2, BoardStatus, BoardTier, LinkListData, PersonalLayout, Source, StatGridData, Widget } from "@/lib/spec";
import { outletsOf, wireItems } from "@/lib/source-brand";
import { newest } from "@/lib/time";
import { BoardHeaderButton } from "./header-button";
import { StatusBreakdown } from "./status-breakdown";
import { MapFocus } from "./map-focus";
import { selectMapFigures } from "./map-figures";

export type BoardProps = {
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
  mapFocus?: { boardId: string; designControl: ReactNode; menu: ReactNode };
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

const tierLabel: Record<BoardTier, string> = {
  hot: "Checked every 2 minutes",
  warm: "Checked every 5 minutes",
  cold: "Checked every 30 minutes",
  paused: "Updates paused",
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
  const compact = laid.compactHeader;
  const newestSource = useMemo(() => newest(sources.map((s) => s.publishedAt)), [sources]);
  const outlets = useMemo(() => outletsOf(sources), [sources]);
  const wire = useMemo(() => wireItems(sources), [sources]);
  const title = header?.title ?? props.title;
  const live = !building && connected && tier !== "paused";

  if (props.specVersion < 2) {
    return (
      <Card padding="lg" radius="xl" role="status" className="gap-4">
        <Caption>Rebuilding this board</Caption>
        <Display as="h1" size="md">
          {title ?? "Live board"}
        </Display>
        <Text tone="subtle" className="max-w-2xl">
          This board was made with an earlier version of Faraday and is being rebuilt from its prompt with the new pipeline. It
          will appear here on its own when it is ready.
        </Text>
        <Text size="sm" tone="muted">
          “{props.prompt}”
        </Text>
      </Card>
    );
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

  function widgetContent(entry: LaidOutWidget, mapFocus = false) {
    const Comp = widgetComponent(entry.widget.type)!;
    return (
      <Comp
        widget={entry.widget}
        data={(entry.data ?? data?.widgets[entry.widget.id]) as never}
        filter={entry.filter as never}
        sources={byId}
        allSources={sources}
        events={events}
        status={status}
        tier={tier}
        building={building}
        mapFocus={mapFocus}
      />
    );
  }

  const map = props.mapFocus && widgets.find(({ widget }) => widget.type === "map");
  if (map && props.mapFocus) {
    const timeline = widgets.find(({ widget }) => widget.type === "timeline");
    const sourceList = widgets.find(({ widget }) => widget.type === "sources");
    const changes = widgets.find(({ widget }) => widget.type === "changelog");
    const overview = widgets.filter(({ widget }) => widget.type === "stat-grid" || widget.type === "narrative" || widget.type === "status-grid");
    const official = widgets.filter(({ widget, data: adjusted }) => {
      if (widget.type !== "link-list") return false;
      const links = (adjusted ?? data?.widgets[widget.id]) as LinkListData | undefined;
      return !!links?.items?.length && links.items.every((item) => item.kind === "official");
    });
    const sections = widgets.filter((entry) =>
      entry !== map && entry !== timeline && entry !== sourceList && entry !== changes &&
      !overview.includes(entry) && !official.includes(entry),
    );
    const figures = overview.filter(({ widget }) => widget.type === "stat-grid");
    const summaryText = header?.headline?.text || header?.subtitle || undefined;
    const mapFigures = selectMapFigures(figures.flatMap((entry) => {
      const stats = (entry.data ?? data?.widgets[entry.widget.id]) as StatGridData | undefined;
      return getStatItems(stats, entry.filter?.kind === "stat-grid" ? entry.filter.metrics : undefined);
    }), summaryText);
    const focusWidget = (entry: LaidOutWidget) => (
      <WidgetBoundary resetKey={entry.data ?? data?.widgets[entry.widget.id]}>
        {widgetContent(entry, true)}
      </WidgetBoundary>
    );
    return (
      <MapFocus
        boardId={props.mapFocus.boardId}
        title={title ?? "Live board"}
        status={<div className="hidden shrink-0 items-center gap-1 @md:flex">
          <Badge variant={live ? "success" : "neutral"} pulse={live}>{building ? "Building" : tier === "paused" ? "Paused" : live ? "Live" : "Offline"}</Badge>
          {header?.status && <Badge variant="outline">{situationLabel[header.status] ?? header.status}</Badge>}
        </div>}
        actions={<div className="flex shrink-0 items-center gap-1">
          {onRefresh && status === "live" && tier !== "paused" && (
            <Tooltip content="Check the web now">
              <BoardHeaderButton icon="search" loading={refreshing} aria-label="Check for updates" onClick={() => void refresh()} />
            </Tooltip>
          )}
          {props.mapFocus.designControl}
          <Menu>
            <MenuTrigger asChild>
              <BoardHeaderButton icon="more" aria-label="Board actions" />
            </MenuTrigger>
            <MenuContent>{props.mapFocus.menu}</MenuContent>
          </Menu>
        </div>}
        map={focusWidget(map)}
        mapFigures={mapFigures.length ? <MapFigureCards items={mapFigures} /> : undefined}
        timeline={timeline ? focusWidget(timeline) : undefined}
        overview={<>
          {summaryText && <Text size="sm">{summaryText} <SourceChips ids={header?.headline?.sources} sources={byId} /></Text>}
          {lastPolledAt && <Text size="sm" tone="muted">Checked <Ago t={lastPolledAt} /></Text>}
          {typeof header?.severity === "number" && (
            <Meter label="Severity" value={Math.min(5, Math.max(0, header.severity))} min={0} max={5}
              low={2} high={4} optimum={0} size="sm"
              formatOptions={{ style: "decimal", maximumFractionDigits: 1 }} getValueLabel={(v) => `${v} of 5`} />
          )}
          <StatusBreakdown sections={sections} data={data} />
          {overview.filter((entry) => entry.widget.type !== "stat-grid").map((entry) => (
            <section key={entry.key} aria-label={entry.widget.title} className="grid gap-2">
              <Heading as="h3" size="sm">{entry.widget.title}</Heading>
              {focusWidget(entry)}
            </section>
          ))}
        </>}
        sections={[...sections, ...figures].map((entry) => ({
          key: entry.key,
          title: entry.widget.type === "stat-grid" ? "Figures and sources" : entry.widget.title,
          showsMapFigures: entry.widget.type === "stat-grid",
          content: focusWidget(entry),
        }))}
        sources={sourceList || official.length ? <>
          {sourceList && focusWidget(sourceList)}
          {official.map((entry) => <section key={entry.key} aria-label={entry.widget.title}>{focusWidget(entry)}</section>)}
        </> : undefined}
        changes={changes ? focusWidget(changes) : undefined}
      />
    );
  }

  return (
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
            {lastPolledAt ? (
              <span>
                checked <Ago t={lastPolledAt} />
              </span>
            ) : null}
            {!building ? <span>{tierLabel[tier]}</span> : null}
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

      {compact ? null : <SourceWire items={wire} label="On the wire" />}

      {widgets.length ? (
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
                {widgetContent(lw)}
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
  );
}
