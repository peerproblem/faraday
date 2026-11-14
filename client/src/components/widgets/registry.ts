import type { ComponentType } from "react";
import type { WidgetType } from "@/lib/spec";
import { OnTheGroundWidget } from "./on-the-ground";
import { AlertListWidget } from "./alert-list";
import { ChangelogWidget } from "./changelog";
import { FeedWidget } from "./feed";
import { LinkListWidget } from "./link-list";
import { MapWidget } from "./map";
import { NarrativeWidget } from "./narrative";
import { SourcesWidget } from "./sources";
import { StatGridWidget } from "./stat-grid";
import { StatusGridWidget } from "./status-grid";
import { TableWidget } from "./table";
import { TimelineWidget } from "./timeline";
import { TrendWidget } from "./trend";
import type { WidgetProps } from "./types";

export const registry: { [T in WidgetType]: ComponentType<WidgetProps<T>> } = {
  "on-the-ground": OnTheGroundWidget,
  narrative: NarrativeWidget,
  "stat-grid": StatGridWidget,
  trend: TrendWidget,
  timeline: TimelineWidget,
  map: MapWidget,
  table: TableWidget,
  "status-grid": StatusGridWidget,
  "alert-list": AlertListWidget,
  "link-list": LinkListWidget,
  feed: FeedWidget,
  changelog: ChangelogWidget,
  sources: SourcesWidget,
};

/** Widgets the browser fills from sources and events; they always have something to show. */
export const clientComputed = new Set<WidgetType>(["feed", "changelog", "sources"]);

/** Null for a type this build does not know, so a newer server never breaks an older client. */
export function widgetComponent(type: string): ComponentType<WidgetProps> | null {
  return (registry as Record<string, ComponentType<WidgetProps>>)[type] ?? null;
}
