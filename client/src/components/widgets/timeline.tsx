"use client";

import { useState } from "react";
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
import { toMs, when } from "@/lib/time";
import { SourceChips } from "./source-chips";
import { TimelineStory } from "./timeline-story";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

type Filter = "all" | "high";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "high", label: "High importance" },
];

export function TimelineWidget({ widget, data, sources, building, filter: personal }: WidgetProps<"timeline">) {
  const [filter, setFilter] = useState<Filter>("all");
  const keep = personal?.minImportance === "high" ? ["high"] : personal?.minImportance === "medium" ? ["high", "medium"] : null;
  const all = (data?.items ?? []).filter((t) => t && typeof t.id === "string" && t.title && (!keep || keep.includes(t.importance)));
  if (!all.length) return <Empty building={building} title="No events yet" />;
  // A personal "Major" filter already shows only high-importance events, so the board's own switch would only disagree.
  const onlyHigh = personal?.minImportance === "high";
  const items = filter === "high" && !onlyHigh ? all.filter((t) => t.importance === "high") : all;
  return (
    <div className="flex flex-col gap-4">
      {!onlyHigh && (
        <div>
          <SegmentedControl<Filter> aria-label={`Filter ${widget.title}`} size="sm" value={filter} onValueChange={setFilter} options={filters} />
        </div>
      )}
      {items.length && widget.display === "story" ? (
        // Remounted per filter, so the story starts again at its first step.
        <TimelineStory key={filter} items={items} sources={sources} label={widget.title} />
      ) : items.length ? (
        <Timeline aria-label={widget.title} size="sm">
          {items.map((t) => (
            // sw3 labels a high-importance event in words, next to its title, whatever its marker shows.
            <TimelineItem key={t.id} value={t.id} importance={t.importance === "high" ? "high" : "normal"}>
              <TimelineMarker />
              <TimelineConnector />
              <TimelineContent>
                <TimelineTitle>{t.title}</TimelineTitle>
                <TimelineTime dateTime={toMs(t.at) !== null ? (t.at ?? undefined) : undefined}>{when(t.at)}</TimelineTime>
                <TimelineDescription>
                  {t.detail ? `${t.detail} ` : null}
                  <SourceChips ids={t.sources} sources={sources} evidence={t.evidence} />
                </TimelineDescription>
              </TimelineContent>
            </TimelineItem>
          ))}
        </Timeline>
      ) : (
        <Empty building={false} title="No high-importance events" description="Switch to all events to see the rest." />
      )}
    </div>
  );
}
