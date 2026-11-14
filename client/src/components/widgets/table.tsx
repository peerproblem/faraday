"use client";

import { useMemo, useState } from "react";
import { ToneBadge, type Tone } from "@/components/ui/badge";
import { TextLink } from "@/components/ui/link";
import { Pagination } from "@/components/ui/pagination";
import { DataTable, type DataTableColumn } from "@/components/ui/table";
import { Text } from "@/components/ui/typography";
import type { ColumnKind, TableData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export const PAGE_SIZE = 20;

const num = (s: string) => {
  const m = s.replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function compare(kind: ColumnKind, a: string, b: string): number {
  if (kind === "number") return (num(a) ?? -Infinity) - (num(b) ?? -Infinity);
  if (kind === "time") return (toMs(a) ?? -Infinity) - (toMs(b) ?? -Infinity);
  return a.localeCompare(b);
}

export function statusTone(v: string): Tone {
  const s = v.toLowerCase();
  if (/(closed|down|outage|critical|evacuat|destroyed|offline|blocked)/.test(s)) return "danger";
  if (/(partial|degraded|limited|warning|delayed|reduced)/.test(s)) return "warning";
  if (/(open|ok|operational|restored|resolved|normal|online)/.test(s)) return "success";
  return "neutral";
}

function Cell({ kind, value }: { kind: ColumnKind; value: string }) {
  if (!value) return <span className="text-muted-foreground">–</span>;
  if (kind === "link" && /^https?:\/\//.test(value)) {
    let host = value;
    try {
      host = new URL(value).hostname.replace(/^www\./, "");
    } catch {}
    return (
      <TextLink href={value} external>
        {host}
      </TextLink>
    );
  }
  if (kind === "time") return <time dateTime={toMs(value) !== null ? value : undefined}>{toMs(value) !== null ? when(value) : value}</time>;
  if (kind === "status") return <ToneBadge tone={statusTone(value)}>{value}</ToneBadge>;
  return <>{value}</>;
}

export function sortRows(data: TableData, sort: { key: string; dir: 1 | -1 } | null) {
  const rows = [...data.rows];
  if (!sort) return rows;
  const col = data.columns.find((c) => c.key === sort.key);
  if (!col) return rows;
  return rows.sort((a, b) => sort.dir * compare(col.kind, a.cells[col.key] ?? "", b.cells[col.key] ?? ""));
}

export function TableWidget({ widget, data, sources, tier, building }: WidgetProps<"table">) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => (data ? sortRows(data, sort) : []), [data, sort]);
  if (!data?.columns?.length || !data.rows?.length) return <Empty building={building}>No rows yet.</Empty>;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const columns: DataTableColumn[] = [
    ...data.columns.map((c) => {
      const active = sort?.key === c.key;
      return {
        key: c.key,
        label: c.label,
        align: c.kind === "number" ? ("end" as const) : ("start" as const),
        sort: {
          direction: active ? (sort!.dir === 1 ? ("ascending" as const) : ("descending" as const)) : ("none" as const),
          label: `Sort ${widget.title} by ${c.label}`,
          onToggle: () => {
            setPage(1);
            setSort(active ? (sort!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 });
          },
        },
      };
    }),
    { key: "__source", label: "Source" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption={widget.title}
        columns={columns}
        rows={shown.map((r) => ({
          id: r.id,
          cells: {
            ...Object.fromEntries(data.columns.map((c) => [c.key, <Cell key={c.key} kind={c.kind} value={r.cells[c.key] ?? ""} />])),
            __source: (
              <span className="flex flex-wrap items-center gap-1.5">
                <SourceChips ids={r.sources} sources={sources} />
                <AsOf t={r.asOf} tier={tier} prefix="" />
              </span>
            ),
          },
        }))}
      />
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text size="sm" tone="muted">
            {rows.length} rows
          </Text>
          <Pagination aria-label={`${widget.title} pages`} size="sm" pageCount={pageCount} page={current} onPageChange={setPage} />
        </div>
      ) : null}
    </div>
  );
}
