"use client";

import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/charts";
import { Stat } from "@/components/ui/stat";
import { Text } from "@/components/ui/typography";
import { AsOf } from "./as-of";
import { cleanPoints, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function StatGridWidget({ data, sources, tier, building }: WidgetProps<"stat-grid">) {
  const items = (data?.items ?? []).filter((k) => k && typeof k.key === "string" && typeof k.valueText === "string");
  if (!items.length) return <Empty building={building}>The sources did not give figures yet.</Empty>;
  return (
    // Tiles are at least 14rem wide, so the widest board fits five across: the design system asks for no more than that.
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
      {items.map((k) => {
        const history = cleanPoints(k.history ?? []);
        return (
          <li key={k.key} className="min-w-0">
            <Card variant="muted" padding="sm" className="h-full gap-3">
              <Stat label={k.label} value={k.unit ? `${k.valueText} ${k.unit}` : k.valueText} delta={k.delta ?? undefined} trend={k.delta ? "flat" : undefined}>
                {history.length > 1 ? (
                  <>
                    <Sparkline data={history.map((p) => p.v)} />
                    <span className="sr-only">{trendSummary(k.label, k.history ?? [], k.unit)}</span>
                  </>
                ) : null}
              </Stat>
              {k.conflict?.length ? (
                <Text size="sm" className="text-warning">
                  Sources disagree:{" "}
                  {k.conflict.map((c, i) => (
                    <span key={`${c.valueText}-${i}`}>
                      {i ? ", " : ""}
                      {c.valueText} <SourceChips ids={c.sources} sources={sources} />
                    </span>
                  ))}
                </Text>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <AsOf t={k.asOf} tier={tier} />
                <SourceChips ids={k.sources} sources={sources} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
