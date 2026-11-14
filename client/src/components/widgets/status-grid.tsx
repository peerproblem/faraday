"use client";

import { ToneBadge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import type { ServiceState } from "@/lib/spec";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const stateLabel: Record<ServiceState, string> = { operational: "Operational", degraded: "Degraded", down: "Down", unknown: "Unknown" };
const stateTone: Record<ServiceState, Tone> = { operational: "success", degraded: "warning", down: "danger", unknown: "neutral" };
const order: ServiceState[] = ["down", "degraded", "unknown", "operational"];

export function StatusGridWidget({ data, sources, tier, building }: WidgetProps<"status-grid">) {
  const items = (data?.items ?? []).filter((x) => x && typeof x.id === "string" && x.name);
  if (!items.length) return <Empty building={building}>No service status reported yet.</Empty>;
  const sorted = [...items].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
  const counts = order.map((s) => [s, items.filter((i) => i.state === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-col gap-4">
      <Text size="sm" tone="muted">
        {counts.map(([s, n]) => `${n} ${stateLabel[s].toLowerCase()}`).join(", ")}
      </Text>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((x) => (
          <li key={x.id} className="min-w-0">
            <Card variant="muted" padding="sm" className="h-full gap-2">
              <div className="flex items-center gap-2">
                <Text as="span" className="min-w-0 flex-1 truncate font-medium">
                  {x.name}
                </Text>
                <ToneBadge tone={stateTone[x.state] ?? "neutral"} dot>
                  {stateLabel[x.state] ?? x.state}
                </ToneBadge>
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
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
