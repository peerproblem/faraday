"use client";

import { Component, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { ToneBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Caption, Text } from "@/components/ui/typography";

export { Empty } from "@/components/ui/skeleton";

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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={`${id}-title`} className="m-0 flex">
            <Caption>{title}</Caption>
          </h2>
          {isNew ? (
            <ToneBadge tone="accent" mono>
              New
            </ToneBadge>
          ) : null}
          {updatedAt ? (
            <Text as="span" size="sm" tone="muted" data-updated>
              Updated <Ago t={updatedAt} />
            </Text>
          ) : null}
          {tools ? <div className="ml-auto flex flex-wrap items-center gap-1.5">{tools}</div> : null}
        </div>
        <WidgetBoundary resetKey={resetKey}>{children}</WidgetBoundary>
      </Card>
      {updatedAt ? <span key={updatedAt} aria-hidden="true" className="fd-updated-ring" /> : null}
    </section>
  );
}
