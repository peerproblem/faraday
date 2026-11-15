import { cleanPoints } from "@/components/widgets/chart";
import type { BoardEntry } from "./entry";
import type { BoardData, TableData, TrendData } from "@/lib/spec";

export function automaticChartEntry(entries: BoardEntry[], data: BoardData | null) {
  let trend: { entry: BoardEntry; newest: number } | undefined;
  let statuses: BoardEntry | undefined;
  for (const entry of entries) {
    const value = data?.widgets[entry.widget.id];
    if (entry.widget.type === "trend") {
      const series = value as TrendData | undefined;
      const points = cleanPoints((series?.points ?? []).filter((point) => point.sources.length > 0));
      const latest = points.at(-1);
      if (latest && latest.x > points[0].x && (!trend || latest.x > trend.newest)) trend = { entry, newest: latest.x };
    }
    if (!statuses && entry.widget.type === "table") {
      const table = value as TableData | undefined;
      const column = table?.columns?.find((column) => column.kind === "status");
      if (column && table?.rows?.some((row) => row.sources.length && row.cells[column.key]?.trim())) statuses = entry;
    }
  }
  return trend?.entry ?? statuses;
}
