"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendChart } from "@/components/ui/charts";
import { Stat } from "@/components/ui/stat";
import { Text } from "@/components/ui/typography";
import type { MapFigure } from "@/components/board/map-figures";
import type { Source, StatGridData, StatItem } from "@/lib/spec";
import { when } from "@/lib/time";
import { AsOf } from "./as-of";
import { cleanPoints, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

/**
 * The value's tone, from the kind of figure (deaths are critical, evacuations a disruption, reopenings good news).
 * sw3 colours the value; a warning also carries its label in words.
 */
const statTone: Record<StatItem["tone"], "danger" | "warning" | "success" | "neutral"> = { critical: "danger", warning: "warning", ok: "success", info: "neutral" };

export function getStatItems(data: StatGridData | undefined) {
  return (data?.items ?? []).filter((item) =>
    item && typeof item.key === "string" && typeof item.label === "string" && typeof item.valueText === "string");
}

export function MapFigureCards({ items, sources, bordered = false }: {
  items: MapFigure[];
  sources: Map<string, Source>;
  bordered?: boolean;
}) {
  return (
    <ul className="fd-workspace-map-figures" aria-label="Map figures">
      {items.map((item) => {
        const tone = statTone[item.tone];
        return (
          <li key={`${item.key}:${item.label}`} className={item.update ? "fd-map-figure-with-update" : undefined}>
            <Card bordered={bordered} padding="none" radius="md" className="fd-map-figure" style={{ padding: "var(--sw-space-3)" }}>
              <Text as="span" size="sm" tone="muted">{item.label}</Text>
              <Text as="span" size="lg" className="font-semibold tabular-nums"
                style={tone && tone !== "neutral" ? { color: `var(--sw-${tone})` } : undefined}>
                {item.valueText}{item.unit && ` ${item.unit}`}
              </Text>
              {item.update && (
                <div className="flex flex-wrap items-center gap-1">
                  <Text as="span" size="sm" tone="muted"><time dateTime={item.update.at}>{when(item.update.at)}</time></Text>
                  <span className="fd-map-figure-source"><SourceChips ids={item.update.sourceIds} sources={sources} collapseAt={2} /></span>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function StatGridWidget({ data, sources, tier, building, mapFocus }: WidgetProps<"stat-grid">) {
  const items = getStatItems(data);
  if (!items.length) return <Empty building={building} title="No figures yet" description="The sources have not given any figures." />;
  return (
    // Metric cells inside the tile, no cards of their own: the tile is the frame. At least 14rem wide, so the widest
    // board fits five across, which is as many as the design system allows in a row.
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-x-6 gap-y-5">
      {items.map((k) => {
        const history = cleanPoints(k.history ?? []);
        return (
          <li key={k.key} className="flex min-w-0 flex-col gap-3">
              <Stat
                size="sm"
                label={k.label}
                value={k.unit ? `${k.valueText} ${k.unit}` : k.valueText}
                delta={k.delta ?? undefined}
                trend={k.delta ? "flat" : undefined}
                tone={statTone[k.tone] ?? "neutral"}
                // The dashboard Stat shows no warning badge, so a disruption is named in its caption.
                caption={k.tone === "warning" ? "Disruption" : undefined}
              >
                {!mapFocus && history.length > 1 ? <TrendChart spark values={history.map((p) => p.v)} aria-label={trendSummary(k.label, k.history ?? [], k.unit)} /> : null}
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
                <SourceChips ids={k.sources} sources={sources} evidence={k.evidence} />
              </div>
          </li>
        );
      })}
    </ul>
  );
}
