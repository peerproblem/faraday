"use client";

import { LineChart } from "@/components/ui/charts";
import { Text } from "@/components/ui/typography";
import { shortTime } from "@/lib/time";
import { cleanPoints, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function TrendWidget({ data, sources, building }: WidgetProps<"trend">) {
  const points = data?.points ?? [];
  const pts = cleanPoints(points);
  if (pts.length < 2 || !data) return <Empty building={building}>Not enough reports for a trend yet.</Empty>;
  const summary = trendSummary(data.label, points, data.unit);
  const last = data.points[data.points.length - 1];
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3">
      <LineChart
        aria-label={summary}
        data={pts}
        x={(d) => d.x}
        series={[{ key: "v", label: data.unit ? `${data.label} (${data.unit})` : data.label }]}
        xFormat={(v) => shortTime(Number(v))}
        curve="linear"
        height={220}
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
