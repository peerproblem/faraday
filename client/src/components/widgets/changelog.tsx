"use client";

import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/typography";
import type { WidgetProps } from "./types";

export function ChangelogWidget({ events }: WidgetProps<"changelog">) {
  const changes = events.filter((e) => e.kind === "update" || e.kind === "change" || e.kind === "edit").slice(0, 20);
  if (!changes.length) {
    return (
      <Text size="sm" tone="muted">
        Nothing has changed since the board was built. The web is checked every few minutes while people are watching.
      </Text>
    );
  }
  return (
    <ul className="grid gap-3">
      {changes.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:flex-nowrap">
          <Text as="span" size="sm" tone="muted" className="w-16 shrink-0 font-mono text-xs">
            <Ago t={e.ts} />
          </Text>
          <Badge mono className="shrink-0">
            {e.kind}
          </Badge>
          <Text as="span" size="sm" className="min-w-0 basis-full sm:basis-auto">
            {e.message}
          </Text>
        </li>
      ))}
    </ul>
  );
}
