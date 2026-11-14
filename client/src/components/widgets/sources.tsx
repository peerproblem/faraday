"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Caption, Text } from "@/components/ui/typography";
import type { SourceType } from "@/lib/spec";
import type { WidgetProps } from "./types";

const STEP = 100;

export function SourcesWidget({ widget, allSources }: WidgetProps<"sources">) {
  const [limit, setLimit] = useState(STEP);
  const byType = allSources.reduce<Partial<Record<SourceType | "untriaged", number>>>((acc, s) => {
    const k = s.sourceType ?? "untriaged";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const shown = allSources.slice(0, limit);
  const breakdown = Object.entries(byType)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return (
    <div className="flex flex-col gap-3">
      <Text size="sm" tone="subtle">
        {allSources.length} sources from the live web, read through Context.dev
        {breakdown ? ` (${breakdown})` : null}
      </Text>
      {allSources.length ? (
        <ScrollArea maxHeight={256} aria-label={`${widget.title} list`}>
          <ol className="grid gap-1.5">
            {shown.map((s) => (
              <li key={s.id} className="flex min-w-0 items-baseline gap-2">
                <Caption className="w-9 shrink-0">{s.id}</Caption>
                <Text as="span" size="sm" tone="muted" className="hidden w-20 shrink-0 @md:inline">
                  {s.sourceType ?? s.kind}
                </Text>
                <Text as="span" size="sm" className="min-w-0 truncate">
                  <Link href={s.url} target="_blank" rel="noreferrer">
                    {s.publisher ? `${s.publisher}: ` : ""}
                    {s.title ?? s.url}
                  </Link>
                </Text>
                {s.via === "oxylabs" ? (
                  <Badge variant="outline" mono className="shrink-0">
                    via Oxylabs
                  </Badge>
                ) : null}
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : null}
      {allSources.length > limit ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + STEP)}>
            Show {Math.min(STEP, allSources.length - limit)} more sources
          </Button>
        </div>
      ) : null}
    </div>
  );
}
