"use client";

import type { ReactNode } from "react";
import { BarList, ChartCard, DonutChart } from "@/components/ui/charts";
import { Text } from "@/components/ui/typography";
import type { BoardData, TableData } from "@/lib/spec";
import type { LaidOutWidget } from "@/lib/client/apply-layout";
import { matchRows, statusTone } from "@/components/widgets/table";

function tableBreakdown(table: TableData, query: string | null | undefined) {
  const column = table.columns.find((column) => column.kind === "status");
  if (!column) return null;
  const rows = matchRows(table.rows, query);
  const buckets = new Map<string, { label: string; value: number }>();
  for (const row of rows) {
    const status = row.cells[column.key]?.trim();
    const key = (status || "").toLowerCase();
    const bucket = buckets.get(key);
    if (bucket) bucket.value += 1;
    else buckets.set(key, { label: status || "Unknown", value: 1 });
  }
  return { total: rows.length, slices: [...buckets.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)) };
}

export function StatusBreakdown({ entry, data, chart = "donut", fallback = null }: {
  entry: LaidOutWidget; data: BoardData | null; chart?: "donut" | "bars"; fallback?: ReactNode;
}) {
  if (entry.widget.type !== "table") return fallback;
  const table = (entry.data ?? data?.widgets[entry.widget.id]) as TableData | undefined;
  if (!table?.columns?.length || !table.rows?.length) return fallback;
  const breakdown = tableBreakdown(table, entry.filter?.kind === "table" ? entry.filter.query : undefined);
  if (!breakdown?.total || (chart === "donut" && (breakdown.slices.length < 2 || breakdown.slices.length > 6))) return fallback;

  const title = `${entry.widget.title} by status`;
  if (chart === "bars") return (
    <ChartCard title={title} variant="ghost" padding="none" bordered={false} className="min-w-0">
      <BarList items={breakdown.slices.map((slice) => ({ id: slice.label, ...slice }))} aria-label={title} />
    </ChartCard>
  );
  const tones = breakdown.slices.map((slice) => statusTone(slice.label));
  const distinctTones = new Set(tones).size === tones.length;
  const slices = breakdown.slices.map((slice, index) => ({
    ...slice,
    color: distinctTones && tones[index] !== "neutral" ? `var(--sw-${tones[index]})` : `var(--sw-chart-${index + 1})`,
  }));
  return (
    <ChartCard title={title} variant="ghost" padding="none" bordered={false} className="min-w-0">
      <div className="fd-workspace-breakdown">
        <DonutChart data={slices} height={132} arcWidth={16} centralLabel={breakdown.total.toLocaleString()}
          centralSubLabel="records" aria-label={`${title}. ${slices.map((slice) => `${slice.label}: ${slice.value}`).join(", ")}.`} />
        <ul className="grid min-w-0 gap-2">
          {slices.map((slice) => (
            <li key={slice.label} className="flex min-w-0 items-start gap-2">
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} />
              <Text as="span" size="sm" className="min-w-0 flex-1 break-words">{slice.label}</Text>
              <Text as="span" size="sm" className="tabular-nums">{slice.value.toLocaleString()}</Text>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
