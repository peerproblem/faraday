"use client";

import { Component, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function WidgetFrame({
  id,
  title,
  span,
  resetKey,
  children,
  transitionName,
  updatedAt,
  isNew = false,
  tools,
}: {
  id: string;
  title: string;
  span: "full" | "half";
  resetKey: unknown;
  children: ReactNode;
  /** Only on personal dashboards, where layout changes animate. */
  transitionName?: string;
  /** When the stream last changed this widget's data in this session. Shows a brief ring and an "Updated" note. */
  updatedAt?: number;
  /** Added to the baseline since the person last saved their layout. */
  isNew?: boolean;
  /** Edit-mode controls, drawn in the title row. */
  tools?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-widget={id}
      className={`@container relative min-w-0 ${span === "full" ? "@4xl:col-span-2" : ""}`}
      style={transitionName ? { viewTransitionName: transitionName } : undefined}
    >
      <Card padding="md" className="h-full">
        <CardHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-2">
          <CardTitle as="h2" id={`${id}-title`}>
            {title}
          </CardTitle>
          {isNew ? <Badge variant="accent">New</Badge> : null}
          {updatedAt ? (
            <Text as="span" size="sm" tone="muted" data-updated>
              Updated <Ago t={updatedAt} />
            </Text>
          ) : null}
          {tools ? <div className="ml-auto flex flex-wrap items-center gap-1.5">{tools}</div> : null}
        </CardHeader>
        <CardContent>
          <WidgetBoundary resetKey={resetKey}>{children}</WidgetBoundary>
        </CardContent>
      </Card>
      {updatedAt ? <span key={updatedAt} aria-hidden="true" className="fd-updated-ring" /> : null}
    </section>
  );
}
