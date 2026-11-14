"use client";

import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { Caption, Text } from "@/components/ui/typography";
import type { WidgetProps } from "./types";

export function ChangelogWidget({ events }: WidgetProps<"changelog">) {
  const changes = events.filter((e) => e.kind === "update" || e.kind === "change" || e.kind === "edit").slice(0, 20);
  if (!changes.length) {
    return (
      <EmptyState
        title="Nothing has changed yet"
        description="Nothing has changed since the board was built. The web is checked every few minutes while people are watching."
      />
    );
  }
  return (
    <ul className="grid gap-3">
      {changes.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 @md:flex-nowrap">
          <Caption className="w-16 shrink-0">
            <Ago t={e.ts} />
          </Caption>
          <Badge variant="outline" className="shrink-0">
            {e.kind}
          </Badge>
          <Text as="span" size="sm" className="min-w-0 basis-full @md:basis-auto">
            {e.message}
          </Text>
        </li>
      ))}
    </ul>
  );
}
