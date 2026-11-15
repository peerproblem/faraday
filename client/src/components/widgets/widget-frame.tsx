"use client";

import { Component, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { DashboardTile } from "@/components/ui/dashboard";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";

/**
 * What a widget shows when it has nothing: skeleton lines while the board is still being built (the region is
 * busy, a status line says so), and an sw3 EmptyState once the widget is known to be empty.
 */
export function Empty({ building, title, description }: { building: boolean; title: string; description?: string }) {
  if (building) {
    return (
      <div className="flex flex-col gap-2">
        <span role="status" className="sr-only">
          Filling in
        </span>
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton height="1.25rem" width="60%" />
          <Skeleton height="1rem" />
          <Skeleton height="1rem" width="80%" />
        </div>
      </div>
    );
  }
  return <EmptyState title={title} description={description} />;
}

type BoundaryProps = { resetKey: unknown; children: ReactNode };

/** One widget failing to render must not take the board down. Resets when its data changes. */
export class WidgetBoundary extends Component<BoundaryProps, { failed: boolean; key: unknown }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { failed: boolean; key: unknown }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    return this.state.failed ? (
      <Text size="sm" tone="muted">
        This section could not be shown.
      </Text>
    ) : (
      this.props.children
    );
  }
}

/** One widget as a tile of the board's DashboardGrid: a panel Card with the widget's title in its header bar. */
export function WidgetFrame({
  id,
  title,
  span,
  resetKey,
  children,
  updatedAt,
}: {
  id: string;
  title: string;
  span: "full" | "half";
  resetKey: unknown;
  children: ReactNode;
  /** When the stream last changed this widget's data in this session. Shows a brief ring and an "Updated" note. */
  updatedAt?: number;
}) {
  const extras =
    updatedAt ? (
      <span className="flex flex-wrap items-center gap-1.5">
        {updatedAt ? (
          <Text as="span" size="sm" tone="muted" data-updated>
            Updated <Ago t={updatedAt} />
          </Text>
        ) : null}
      </span>
    ) : undefined;
  return (
    <DashboardTile
      id={id}
      span={span === "full" ? 12 : 6}
      title={title}
      headingLevel={2}
      actions={extras}
      role="region"
      aria-label={title}
      data-widget={id}
      padding="md"
    >
      <div className="@container relative min-w-0">
        <WidgetBoundary resetKey={resetKey}>{children}</WidgetBoundary>
      </div>
      {updatedAt ? <span key={updatedAt} aria-hidden="true" className="fd-updated-ring" /> : null}
    </DashboardTile>
  );
}
