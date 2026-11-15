"use client";

import { TrendChart } from "@/components/ui/charts";
import { Text } from "@/components/ui/typography";
import { shortTime } from "@/lib/time";
import { cleanPoints, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function TrendWidget({ data, sources, building, mapFocus }: WidgetProps<"trend">) {
  const points = data?.points ?? [];
  const pts = cleanPoints(points);
  if (pts.length < 2 || !data) return <Empty building={building} title="Not enough reports for a trend" description="A trend needs at least two reports of the figure." />;
  const summary = trendSummary(data.label, points, data.unit);
  const last = data.points[data.points.length - 1];
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3">
      <TrendChart
        aria-label={summary}
        values={pts.map((p) => p.v)}
        labels={pts.map((p) => shortTime(p.x))}
        seriesLabels={[data.unit ? `${data.label} (${data.unit})` : data.label, "Previous"]}
        format={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        variant={mapFocus && pts.length <= 12 ? "bars" : undefined}
        height={mapFocus ? 186 : 220}
      />
      <figcaption className="flex flex-wrap items-center gap-2">
        <Text as="span" size="sm" tone="muted">
          {summary}
        </Text>
        {last ? <SourceChips ids={last.sources} sources={sources} /> : null}
      </figcaption>
    </figure>
  );
}
