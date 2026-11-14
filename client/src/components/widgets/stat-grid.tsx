"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/charts";
import { Stat } from "@/components/ui/stat";
import { Text } from "@/components/ui/typography";
import type { StatItem } from "@/lib/spec";
import { AsOf } from "./as-of";
import { cleanPoints, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

/** The items to show: with a personal metric filter, only those metrics and in that order. */
export function pickMetrics<T extends { key: string }>(items: T[], metrics: string[] | undefined): T[] {
  if (!metrics?.length) return items;
  const byKey = new Map(items.map((i) => [i.key, i]));
  return metrics.map((m) => byKey.get(m)).filter((i): i is T => !!i);
}

/**
 * The value's tone, from the kind of figure (deaths are critical, evacuations a disruption, reopenings good news).
 * sw3 colours the value; a warning also carries its label in words.
 */
const statTone: Record<StatItem["tone"], "danger" | "warning" | "success" | "neutral"> = { critical: "danger", warning: "warning", ok: "success", info: "neutral" };

export function StatGridWidget({ data, sources, tier, building, filter }: WidgetProps<"stat-grid">) {
  const items = pickMetrics(
    (data?.items ?? []).filter((k) => k && typeof k.key === "string" && typeof k.valueText === "string"),
    filter?.metrics,
  );
  if (!items.length) return <Empty building={building} title="No figures yet" description="The sources have not given any figures." />;
  return (
    // Tiles are at least 14rem wide, so the widest board fits five across: the design system asks for no more than that.
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
      {items.map((k) => {
        const history = cleanPoints(k.history ?? []);
        return (
          <li key={k.key} className="min-w-0">
            <Card variant="muted" padding="sm" className="h-full gap-3">
              <Stat
                label={k.label}
                value={k.unit ? `${k.valueText} ${k.unit}` : k.valueText}
                delta={k.delta ?? undefined}
                trend={k.delta ? "flat" : undefined}
                tone={statTone[k.tone] ?? "neutral"}
                warningLabel="Disruption"
              >
                {history.length > 1 ? (
                  <>
                    <Sparkline data={history.map((p) => p.v)} />
                    <span className="sr-only">{trendSummary(k.label, k.history ?? [], k.unit)}</span>
                  </>
                ) : null}
              </Stat>
              {k.conflict?.length ? (
                <Text size="sm" tone="subtle">
                  <Badge variant="warning">Sources disagree</Badge>{" "}
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
