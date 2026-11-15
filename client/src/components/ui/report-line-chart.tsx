"use client";

import { VisAxis } from "@unovis/react/components/axis";
import { VisLine } from "@unovis/react/components/line";
import { VisXYLabels } from "@unovis/react/components/xy-labels";
import { VisXYContainer } from "@unovis/react/containers/xy-container";
import { ChartSurface } from "./charts";

type ReportLinePoint = { x: number; plotted: number | undefined };

const x = (point: ReportLinePoint) => point.x;
const y = (point: ReportLinePoint) => point.plotted ?? Number.NaN;

export function ReportLineChart({ points, last, label, series, axisLabel, compact, formatX, formatY }: {
  points: ReportLinePoint[];
  last: ReportLinePoint;
  label: string;
  series: string;
  axisLabel?: string;
  compact: boolean;
  formatX: (timestamp: number) => string;
  formatY: (value: number) => string;
}) {
  const firstTime = points[0].x;
  const lastTime = points[points.length - 1].x;
  const extension = Math.max((lastTime - firstTime) * 0.24, 3_600_000);
  const lineColor = "var(--sw-chart-1)";
  // End labels are centred on their anchor. Reserve their trailing half inside the SVG.
  const labelFontSize = compact ? 10 : 12;
  const labelSpace = Math.ceil(series.length * labelFontSize * 0.34) + 12;

  return (
    <ChartSurface name="report-line" role="img" aria-label={label}>
      {/* Match the gallery: observations and end labels are independent component datasets. */}
      <VisXYContainer duration={0} height={compact ? 106 : 260} margin={{ top: 12, right: labelSpace }}
        xDomain={[firstTime, lastTime + extension]}>
        <VisLine data={points} x={x} y={y} color={lineColor} fallbackValue={undefined} />
        <VisXYLabels data={[last]} x={last.x + extension * 0.48} y={y}
          label={series} color={lineColor} backgroundColor="none" labelFontSize={labelFontSize} clustering={false} />
        <VisAxis type="x" numTicks={compact ? 3 : 4} minMaxTicksOnlyWhenWidthIsLess={150}
          tickTextAdaptiveSets tickFormat={(tick) => Number(tick) > lastTime ? "" : formatX(Number(tick))} />
        <VisAxis type="y" numTicks={compact ? 3 : 5} label={compact ? undefined : axisLabel}
          tickFormat={(tick) => formatY(Number(tick))} />
      </VisXYContainer>
    </ChartSurface>
  );
}
