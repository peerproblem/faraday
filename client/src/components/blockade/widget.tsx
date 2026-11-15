"use client";

import { createElement, type ReactNode } from "react";
import { widgetComponent } from "@/components/widgets/registry";
import type { WidgetProps } from "@/components/widgets/types";
import { WidgetBoundary } from "@/components/widgets/widget-frame";
import type { BoardData, BoardEvent, BoardStatus, BoardTier, Source, Widget } from "@/lib/spec";

/** What every panel needs to draw one of the board's own widgets or cite a source. */
export type BlockadeContext = {
  data: BoardData | null;
  sources: Map<string, Source>;
  allSources: Source[];
  events: BoardEvent[];
  status: BoardStatus;
  tier: BoardTier;
  building: boolean;
};

/** One of the board's widgets, drawn by its shared component with the compact panel settings. */
export function BoardWidget({ widget, context, data, extra }: {
  widget: Widget | undefined;
  context: BlockadeContext;
  /** Replaces the widget's own data, for a filtered view of it. */
  data?: unknown;
  extra?: Partial<WidgetProps>;
}) {
  const component = widget && widgetComponent(widget.type);
  if (!widget || !component) return null;
  const value = data ?? context.data?.widgets[widget.id];
  return (
    <WidgetBoundary resetKey={value}>
      {createElement(component, {
        widget, data: value as never, sources: context.sources, allSources: context.allSources, events: context.events,
        status: context.status, tier: context.tier, building: context.building, mapFocus: true, ...extra,
      })}
    </WidgetBoundary>
  );
}

/** A titled block of a panel. The title row can carry a short figure or control on its right. */
export function PanelSection({ title, aside, children, label }: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section className="fd-blockade-section" aria-label={label ?? title}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold">{title}</h3>
        {aside && <div className="shrink-0 text-sm text-muted-foreground tabular-nums">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A categorical colour mark for a legend row, a ranked bar or a badge. */
export function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="fd-blockade-dot" style={{ background: color }} />;
}
