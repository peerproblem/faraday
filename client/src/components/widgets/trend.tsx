"use client";

import { TrendChart } from "@/components/ui/charts";
import { Text } from "@/components/ui/typography";
import { shortTime, when } from "@/lib/time";
import { cleanPoints, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { CyberTrend } from "./cyber-trend";
import { Empty } from "./widget-frame";

export function TrendWidget({ data, sources, building, mapFocus, compactTrendAxis, cyberPresentation, transportPresentation }: WidgetProps<"trend">) {
  const points = data?.points ?? [];
  const pts = cleanPoints(points);
  if (pts.length < 2 || !data) return <Empty building={building} title="Not enough reports for a trend" description="A trend needs at least two reports of the figure." />;
  if (cyberPresentation) return <CyberTrend data={data} sources={sources} />;
  const summary = transportPresentation ? `${data.label} · ${pts.length} dated reports` : trendSummary(data.label, points, data.unit);
  const last = data.points[data.points.length - 1];
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <TrendChart
          aria-label={summary}
          className={compactTrendAxis ? "fd-compact-trend" : undefined}
          values={pts.map((p) => p.v)}
          labels={pts.map((p) => `${shortTime(p.x)}${compactTrendAxis ? " UTC" : ""}`)}
          seriesLabels={[data.unit ? `${data.label} (${data.unit})` : data.label, "Previous"]}
          format={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          variant={mapFocus && pts.length <= 12 ? "bars" : undefined}
          height={mapFocus ? 186 : 220}
        />
        {compactTrendAxis && (
          <div className="pointer-events-none -mt-5 grid grid-cols-2 gap-x-2 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            <time data-trend-endpoint dateTime={pts[0].t}>{shortTime(pts[0].x)} UTC</time>
            <time data-trend-endpoint dateTime={pts[pts.length - 1].t} className="text-right">
              {shortTime(pts[pts.length - 1].x)} UTC
            </time>
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-2">
        <Text as="span" size="sm" tone="muted">
          {summary}
        </Text>
        {!transportPresentation && last ? <SourceChips ids={last.sources} sources={sources} /> : null}
      </figcaption>
      {transportPresentation && <>
        <Text size="sm" tone="muted">Reported totals may cover different periods or services. Compare the source reports before interpreting a change as recovery.</Text>
        <details className="fd-transport-readings">
          <summary>Reported readings & sources ({points.length})</summary>
          <ul>{points.map((point, index) => <li key={`${point.t}:${index}`}>
            <time dateTime={point.t}>{when(point.t)}</time>
            <strong>{point.v.toLocaleString("en-US", { maximumFractionDigits: 2 })}{data.unit ? ` ${data.unit}` : ""}</strong>
            <SourceChips ids={point.sources} sources={sources} collapseAt={3} compactLabel />
          </li>)}</ul>
        </details>
      </>}
    </figure>
  );
}
