"use client";

import { ReportLineChart } from "@/components/ui/report-line-chart";
import { Text } from "@/components/ui/typography";
import type { Source, TrendData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import { SourceChips } from "./source-chips";
import { reportedTrendValue } from "./cyber-chart-data";

const reportDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compactUSD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});
const exactUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
type ReportPoint = TrendData["points"][number] & { x: number; plotted: number | undefined };

export function CyberTrend({ data, sources, compact = false }: {
  data: TrendData;
  sources: Map<string, Source>;
  compact?: boolean;
}) {
  const citedText = data.points.map(point => point.sources.map(id => sources.get(id)?.snippet ?? "").join(" "));
  const mixedCoverage = /reserves-coverage$/.test(data.metric)
    && citedText.some(text => /impacted|affected/i.test(text) && /replenish/i.test(text))
    && citedText.some(text => /reserve ratio/i.test(text));
  const unit = data.unit?.trim();
  const dollars = /^USD(?:\s|$)/i.test(unit ?? "");
  const points = data.points.flatMap((point): ReportPoint[] => {
    const time = toMs(point.t);
    if (time === null || !Number.isFinite(point.v)) return [];
    const plotted = reportedTrendValue(point, unit, sources);
    return [{ ...point, x: time, plotted }];
  }).sort((a, b) => a.x - b.x);
  const available = points.filter(({ plotted }) => plotted !== undefined);
  const last = available.at(-1);
  const formatAxis = (n: number) => dollars ? compactUSD.format(n) : `${number.format(n)}${unit === "%" ? "%" : ""}`;
  const formatValue = (n: number) => dollars ? exactUSD.format(n) : `${formatAxis(n)}${unit && unit !== "%" ? ` ${unit}` : ""}`;
  const gapCount = points.length - available.length;
  // The currency axis already says Amount; keep the end label short in a narrow Details card.
  const seriesLabel = data.label.replace(/^Amount\s+/i, "");

  return (
    <figure className="m-0 grid min-w-0 gap-2">
      {mixedCoverage ? (
        <Text size="sm" tone="muted">These reports mix asset replenishment and reserve ratios. Review the individual measurements and their sources below.</Text>
      ) : last && last.plotted !== undefined ? (
        <ReportLineChart points={points} last={last} label={
          `${data.label} across ${available.length} reports. Latest plotted value: ${formatValue(last.plotted)}.${gapCount ? ` ${gapCount} gaps.` : ""}`
        } compact={compact} formatX={(date) => reportDay.format(date)} formatY={formatAxis}
          series={compact && /reserves-coverage$/.test(data.metric) ? "Coverage" : seriesLabel.length <= 16 ? seriesLabel : "Reported"}
          axisLabel={dollars ? "Amount (USD)" : unit === "%" ? "Percent (%)" : unit ?? data.label} />
      ) : (
        <Text size="sm" tone="muted">No comparable values are available. The individual source reports are listed below.</Text>
      )}
      {gapCount > 0 && <Text size="sm" tone="muted">Gaps mark reports whose dollar scale could not be verified from their cited text.</Text>}
      {!compact && (
        <details open={mixedCoverage || !last} className="min-w-0 rounded-md border border-hairline p-2">
          <summary className="cursor-pointer text-sm font-medium">Reported readings ({points.length})</summary>
          <ul className="mt-2 grid gap-2 text-sm">
            {points.map((point, index) => (
              <li key={`${point.t}:${index}`} className="grid gap-1 border-t border-hairline pt-2">
                <time dateTime={point.t}>{when(point.t)}</time>
                {point.plotted === undefined
                  ? <span className="text-xs text-muted-foreground">Raw reading: {number.format(point.v)} · scale unverified</span>
                  : <span className="font-medium tabular-nums">{formatValue(point.plotted)}</span>}
                <SourceChips ids={point.sources} sources={sources} collapseAt={4} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </figure>
  );
}
