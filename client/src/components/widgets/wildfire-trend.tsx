"use client";

import { useState } from "react";
import type { Source, TrendData } from "@/lib/spec";
import { pacificReportTime } from "@/lib/time";
import { cleanPoints, linePath, trendSummary } from "./chart";
import { SourceChips } from "./source-chips";
import { Text } from "@/components/ui/typography";

const width = 360;
const height = 144;
const pad = 6;
const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function WildfireTrend({ data, sources }: { data: TrendData; sources: Map<string, Source> }) {
  const [selected, setSelected] = useState<number>();
  const points = cleanPoints(data.points);
  const latest = points[points.length - 1];
  const currentIndex = Math.min(selected ?? points.length - 1, points.length - 1);
  const current = points[currentIndex];
  const summary = trendSummary(data.label, data.points, data.unit, pacificReportTime);
  const values = points.map(({ v }) => v);
  const low = Math.min(0, ...values);
  const high = Math.max(data.unit === "%" ? 100 : 1, ...values);
  const middle = low + (high - low) / 2;
  const display = (n: number, unit = data.unit) => `${format.format(n)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
  const { d, dots } = linePath(data.points, width, height, pad, [low, high]);

  return (
    <figure className="m-0 grid min-w-0 gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-stretch gap-x-2">
        <div className="flex h-36 flex-col justify-between py-0.5 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {[high, middle, low].map((tick) => <span key={tick}>{display(tick, data.unit === "%" ? "%" : null)}</span>)}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
          className="h-36 w-full" role="img" aria-label={summary}
          onPointerMove={(event) => {
            if (event.pointerType !== "mouse") return;
            const box = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - box.left) / box.width * width;
            const nearest = dots.reduce((best, dot, index) =>
              Math.abs(dot.cx - x) < Math.abs(dots[best].cx - x) ? index : best, 0);
            setSelected(nearest);
          }}>
          {[pad, height / 2, height - pad].map((y) => (
            <line key={y} x1={pad} x2={width - pad} y1={y} y2={y} stroke="var(--sw-hairline)" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={d} fill="none" stroke="var(--sw-chart-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {dots.map(({ cx, cy }, index) => (
            <circle key={index} cx={cx} cy={cy} r={index === currentIndex ? 4 : 2.75}
              fill={index === currentIndex ? "var(--sw-chart-1)" : "var(--sw-background)"}
              stroke="var(--sw-chart-1)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
              data-report-point={points[index].t} />
          ))}
        </svg>
        <div className="col-start-2 grid grid-cols-2 gap-2 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          <time dateTime={points[0].t}>{pacificReportTime(points[0].t)}</time>
          <time dateTime={latest.t} className="text-right">{pacificReportTime(latest.t)}</time>
        </div>
      </div>
      <figcaption className="grid min-w-0 gap-2">
        <Text size="sm" tone="muted">
          {display(points[0].v)} → {display(latest.v)} across {points.length} reports. Each dot marks a report.
        </Text>
        <label className="grid min-w-0 gap-1 text-sm">
          <span className="font-medium">Reported observation</span>
          <select className="min-w-0 w-full rounded-md border border-hairline bg-background p-2 text-sm"
            value={currentIndex} onChange={(event) => setSelected(Number(event.target.value))}>
            {points.map((point, index) => (
              <option key={index} value={index}>{pacificReportTime(point.t)} · {display(point.v)}</option>
            ))}
          </select>
        </label>
        <SourceChips ids={current.sources} sources={sources} collapseAt={5} />
      </figcaption>
    </figure>
  );
}
