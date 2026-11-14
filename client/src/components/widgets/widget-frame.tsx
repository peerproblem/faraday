"use client";

import { Component, type ReactNode } from "react";
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
}: {
  id: string;
  title: string;
  span: "full" | "half";
  resetKey: unknown;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} data-widget={id} className={`min-w-0 ${span === "full" ? "lg:col-span-2" : ""}`}>
      <Card padding="md" className="h-full">
        <h2 id={`${id}-title`} className="m-0 flex">
          <Caption>{title}</Caption>
        </h2>
        <WidgetBoundary resetKey={resetKey}>{children}</WidgetBoundary>
      </Card>
    </section>
  );
}
