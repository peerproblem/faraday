"use client";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { Heading, Text } from "@/components/ui/typography";
import type { ServiceState } from "@/lib/spec";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const stateLabel: Record<ServiceState, string> = { operational: "Operational", degraded: "Degraded", down: "Down", unknown: "Unknown" };
const stateTone: Record<ServiceState, BadgeVariant> = { operational: "success", degraded: "warning", down: "danger", unknown: "neutral" };
const stateIcon: Record<ServiceState, IconName> = { operational: "check", degraded: "alert", down: "close", unknown: "info" };
const order: ServiceState[] = ["down", "degraded", "unknown", "operational"];

export function StatusGridWidget({ data, sources, tier, building }: WidgetProps<"status-grid">) {
  const items = (data?.items ?? []).filter((x) => x && typeof x.id === "string" && x.name);
  if (!items.length) return <Empty building={building} title="No service status yet" description="The sources have not reported on any service." />;
  const sorted = [...items].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
  const counts = order.map((s) => [s, items.filter((i) => i.state === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-col gap-4">
      <Text size="sm" tone="muted">
        {counts.map(([s, n]) => `${n} ${stateLabel[s].toLowerCase()}`).join(", ")}
      </Text>
      {/* Service cells inside the tile, no cards of their own: the tile is the frame. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-x-6 gap-y-5">
        {sorted.map((x) => (
          <li key={x.id} className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Heading as="h3" size="sm" className="min-w-0 flex-1 basis-32 [overflow-wrap:anywhere]">
                  {x.name}
                </Heading>
                <span className="shrink-0">
                  <Badge variant={stateTone[x.state] ?? "neutral"} leading={<Icon name={stateIcon[x.state] ?? "info"} weight={2} />}>
                    {stateLabel[x.state] ?? x.state}
                  </Badge>
                </span>
              </div>
              {x.note ? (
                <Text size="sm" tone="subtle">
                  {x.note}
                </Text>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <AsOf t={x.asOf} tier={tier} />
                <SourceChips ids={x.sources} sources={sources} />
              </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
