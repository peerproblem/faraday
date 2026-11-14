"use client";

import { useMemo, useState } from "react";
import { Ago } from "@/components/ago";
import { ToneBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Caption, Display, Text } from "@/components/ui/typography";
import { clientComputed, widgetComponent } from "@/components/widgets/registry";
import { SourceChips } from "@/components/widgets/source-chips";
import { WidgetFrame } from "@/components/widgets/widget-frame";
import type { BoardData, BoardEvent, BoardSpecV2, BoardStatus, BoardTier, Source, Widget } from "@/lib/spec";
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
};

const stageText: Record<string, string> = {
  queued: "Queued",
  planning: "Compiling the prompt into a plan",
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
  const widgets = visibleWidgets(spec, data, building);
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
          <ToneBadge tone={building ? "accent" : live ? "success" : "neutral"}>
            {live || building ? <span aria-hidden="true" className="fd-live-dot" /> : null}
            {building ? "Building" : tier === "paused" ? "Paused" : connected ? "Live" : "Offline"}
          </ToneBadge>
          {header?.status ? <ToneBadge tone="neutral">{situationLabel[header.status] ?? header.status}</ToneBadge> : null}
          {header?.crisisType ? (
            <ToneBadge tone="neutral" mono>
              {header.crisisType}
            </ToneBadge>
          ) : null}
        </div>

        {title ? (
          <Display as="h1" size="md">
            {title}
          </Display>
        ) : (
          <Skeleton className="h-12 w-2/3" />
        )}
        {header?.subtitle ? <Text tone="muted">{header.subtitle}</Text> : null}

        {header?.headline?.text ? (
          <Text size="lg" tone="subtle" className="max-w-4xl">
            {header.headline.text} <SourceChips ids={header.headline.sources} sources={byId} />
          </Text>
        ) : building ? (
          <>
            <Skeleton className="h-6 w-full max-w-3xl" />
            <Text size="sm" tone="muted" role="status">
              {props.stage ?? stageText[status] ?? "Working"}
              {status === "composing" ? `, ${sources.length} sources so far. Sections appear as they are filled.` : "…"}
            </Text>
          </>
        ) : null}

        <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-t border-hairline pt-5">
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
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
          {widgets.map((w) => {
            const Comp = widgetComponent(w.type)!;
            const d = data?.widgets[w.id];
            return (
              <WidgetFrame key={w.id} id={w.id} title={w.title} span={w.span} resetKey={d}>
                <Comp
                  widget={w}
                  data={d as never}
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
        </div>
      ) : building ? (
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
          <Skeleton className="h-40 @4xl:col-span-2" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : status === "error" ? (
        <Card padding="md" role="alert">
          <Text className="text-danger">The board could not be built. {events.find((e) => e.kind === "error")?.message ?? ""}</Text>
        </Card>
      ) : null}
    </div>
  );
}
