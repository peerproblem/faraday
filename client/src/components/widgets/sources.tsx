"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Text } from "@/components/ui/typography";
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
        {breakdown ? <span className="text-muted-foreground"> ({breakdown})</span> : null}
      </Text>
      {allSources.length ? (
        <ScrollArea maxHeight={256} aria-label={`${widget.title} list`}>
          <ol className="grid gap-1.5">
            {shown.map((s) => (
              <li key={s.id} className="flex min-w-0 gap-2 text-sm">
                <span className="w-9 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{s.id}</span>
                <span className="hidden w-20 shrink-0 text-muted-foreground @md:inline">{s.sourceType ?? s.kind}</span>
                <TextLink href={s.url} external className="min-w-0 truncate text-subtle">
                  {s.publisher ? `${s.publisher}: ` : ""}
                  {s.title ?? s.url}
                </TextLink>
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
