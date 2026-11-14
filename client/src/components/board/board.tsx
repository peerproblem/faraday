"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardGrid } from "@/components/ui/dashboard";
import { Meter } from "@/components/ui/meter";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Caption, Display, Text } from "@/components/ui/typography";
import { Separator } from "@/components/ui/separator";
import { clientComputed, widgetComponent } from "@/components/widgets/registry";
import { SourceChips } from "@/components/widgets/source-chips";
import { WidgetFrame } from "@/components/widgets/widget-frame";
import { applyLayout, type LaidOutWidget } from "@/lib/client/apply-layout";
import { transitionName } from "@/lib/client/view-transition";
import type { BoardData, BoardEvent, BoardSpecV2, BoardStatus, BoardTier, PersonalLayout, Source, Widget } from "@/lib/spec";
import { newest } from "@/lib/time";

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
          <Text as="div" size="sm" tone="muted" className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
            <span>{sources.length} sources read</span>
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

      {widgets.length ? (
        <DashboardGrid aria-label={`${title ?? "Board"} sections`} minTileWidth={420}>
          {widgets.map((lw) => {
            const w = lw.widget;
            const Comp = widgetComponent(w.type)!;
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
                <Comp
                  widget={w}
                  data={d as never}
                  filter={lw.filter as never}
                  sources={byId}
                  allSources={sources}
                  events={events}
                  status={status}
                  tier={tier}
                  building={building}
                />
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
