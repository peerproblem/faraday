"use client";

import { useState } from "react";
import { ToneBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@/components/ui/timeline";
import { Text } from "@/components/ui/typography";
import { toMs, when } from "@/lib/time";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

type Filter = "all" | "high";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "high", label: "Major only" },
];

export function TimelineWidget({ widget, data, sources, building, filter: personal }: WidgetProps<"timeline">) {
  const [filter, setFilter] = useState<Filter>("all");
  const keep = personal?.minImportance === "high" ? ["high"] : personal?.minImportance === "medium" ? ["high", "medium"] : null;
  const all = (data?.items ?? []).filter((t) => t && typeof t.id === "string" && t.title && (!keep || keep.includes(t.importance)));
  if (!all.length) return <Empty building={building}>No events yet.</Empty>;
  const items = filter === "high" ? all.filter((t) => t.importance === "high") : all;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SegmentedControl<Filter> aria-label={`Filter ${widget.title}`} size="sm" value={filter} onValueChange={setFilter} options={filters} />
      </div>
      {items.length ? (
        <Timeline aria-label={widget.title} size="sm">
          {items.map((t) => (
            <TimelineItem key={t.id} value={t.id} data-importance={t.importance}>
              {/* Importance is said in words too, so it never rests on the marker alone. */}
              <TimelineMarker>{t.importance === "high" ? <Icon name="alert" aria-hidden="true" /> : null}</TimelineMarker>
              <TimelineConnector />
              <TimelineContent>
                <TimelineTitle>
                  {t.title}
                  {t.importance === "high" ? (
                    <>
                      {" "}
                      <ToneBadge tone="danger" mono>
                        Major
                      </ToneBadge>
                    </>
                  ) : null}
                </TimelineTitle>
                <TimelineTime dateTime={toMs(t.at) !== null ? (t.at ?? undefined) : undefined}>{when(t.at)}</TimelineTime>
                <TimelineDescription>
                  {t.detail ? `${t.detail} ` : null}
                  <SourceChips ids={t.sources} sources={sources} />
                </TimelineDescription>
              </TimelineContent>
            </TimelineItem>
          ))}
        </Timeline>
      ) : (
        <Text size="sm" tone="muted">
          No major events. Switch to all events to see the rest.
        </Text>
      )}
    </div>
  );
}
