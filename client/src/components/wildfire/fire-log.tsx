"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Legend, Tracker } from "@/components/ui/charts";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/skeleton";
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
import { SourceChips } from "@/components/widgets/source-chips";
import type { Source } from "@/lib/spec";
import type { DayState, WildfireView } from "./wildfire-data";

type Filter = "all" | "key";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "key", label: "Key events" },
];

const stateText: Record<DayState["state"], string> = {
  orders: "Evacuation orders in force",
  burning: "Fire not yet contained",
  contained: "Fully contained",
};
const trackerStatus = { orders: "down", burning: "degraded", contained: "ok" } as const;
const dayLegend = [
  { key: "orders", label: "Orders", color: "var(--sw-danger)" },
  { key: "burning", label: "Burning", color: "var(--sw-warning)" },
  { key: "contained", label: "Contained", color: "var(--sw-success)" },
];

/** The left panel: the incident day by day, in the time zone it was reported in. */
export function FireLog({ view, sources }: { view: WildfireView; sources: Map<string, Source> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { clock, days } = view;
  const groups = view.log
    .map((group) => ({ ...group, entries: filter === "key" ? group.entries.filter((entry) => entry.key) : group.entries }))
    .filter((group) => group.entries.length);
  const total = view.log.reduce((sum, group) => sum + group.entries.length, 0);
  if (!total) return <EmptyState title="No events yet" description="Dated events appear here as sources report them." />;
  const zone = view.ignition === null ? "" : clock.zone(view.ignition);

  return (
    <div className="fd-fire-log">
      {days.length > 1 && (
        <section className="grid gap-2" aria-label="Incident days">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">{days.length} days</h3>
            <Text as="span" size="sm" tone="muted">{clock.shortDay(days[0].ms)} to {clock.shortDay(days[days.length - 1].ms)}</Text>
          </div>
          <Tracker
            aria-label={`The incident by day: ${days.map((d) => `${clock.shortDay(d.ms)} ${stateText[d.state].toLowerCase()}`).join(", ")}`}
            height={28}
            items={days.map((d) => ({
              status: trackerStatus[d.state],
              label: `${clock.shortDay(d.ms)}, day ${d.day}: ${stateText[d.state]}${d.containment === null ? "" : `, ${d.containment}% contained`}`,
            }))}
          />
          <Legend series={dayLegend} />
        </section>
      )}

      <SegmentedControl<Filter> aria-label="Filter the fire log" size="sm" fullWidth value={filter} onValueChange={setFilter} options={filters} />

      {groups.map((group) => (
        <section key={group.key} className="grid gap-3" aria-label={group.ms === null ? "Events without a date" : clock.day(group.ms)}>
          <header className="fd-fire-day">
            <h3 className="text-base font-semibold">{group.ms === null ? "Date not reported" : clock.day(group.ms)}</h3>
            {group.day !== null && <Text as="span" size="sm" tone="muted">Day {group.day}</Text>}
            {group.containment !== null && (
              <Badge variant={group.containment >= 100 ? "success" : "neutral"} className="ml-auto">{group.containment}% contained</Badge>
            )}
          </header>
          <Timeline aria-label={group.ms === null ? "Events without a date" : `Events on ${clock.day(group.ms)}`} size="sm">
            {group.entries.map((entry) => (
              <TimelineItem key={entry.id} value={entry.id} importance={entry.key ? "high" : "normal"}>
                <TimelineMarker />
                <TimelineConnector />
                <TimelineContent>
                  <TimelineTitle>{entry.title}</TimelineTitle>
                  {entry.ms !== null && !entry.dateOnly && (
                    <TimelineTime dateTime={new Date(entry.ms).toISOString()}>{clock.time(entry.ms)} {zone}</TimelineTime>
                  )}
                  <TimelineDescription>
                    {entry.detail ? `${entry.detail} ` : null}
                    <SourceChips ids={entry.sources} sources={sources} evidence={entry.evidence} collapseAt={3} compactLabel />
                  </TimelineDescription>
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        </section>
      ))}
      {!groups.length && <EmptyState title="No key events" description="Switch to all events to see the rest." />}
    </div>
  );
}
