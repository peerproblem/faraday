"use client";

import { useMemo, useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Link } from "@/components/ui/link";
import { Pagination } from "@/components/ui/pagination";
import { Table, type TableColumn, type TableSort } from "@/components/ui/table";
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

export function statusTone(v: string): BadgeVariant {
  const s = v.toLowerCase();
  if (/(closed|down|outage|critical|evacuat|destroyed|offline|blocked)/.test(s)) return "danger";
  if (/(partial|degraded|limited|warning|delayed|reduced)/.test(s)) return "warning";
  if (/(open|ok|operational|restored|resolved|normal|online)/.test(s)) return "success";
  return "neutral";
}

function Cell({ kind, value }: { kind: ColumnKind; value: string }) {
  if (!value)
    return (
      <Text as="span" size="sm" tone="muted">
        –
      </Text>
    );
  if (kind === "link" && /^https?:\/\//.test(value)) {
    let host = value;
    try {
      host = new URL(value).hostname.replace(/^www\./, "");
    } catch {}
    return (
      <Link href={value} target="_blank" rel="noreferrer">
        {host}
      </Link>
    );
  }
  if (kind === "time") return <time dateTime={toMs(value) !== null ? value : undefined}>{toMs(value) !== null ? when(value) : value}</time>;
  if (kind === "status") return <Badge variant={statusTone(value)}>{value}</Badge>;
  return <>{value}</>;
}

/** All rows in the table's sort order. Sorting happens here, before paging, so page 2 continues page 1. */
export function sortRows(data: TableData, sort: TableSort | null) {
  const rows = [...data.rows];
  if (!sort) return rows;
  const col = data.columns.find((c) => c.key === sort.columnId);
  if (!col) return rows;
  const dir = sort.direction === "descending" ? -1 : 1;
  return rows.sort((a, b) => dir * compare(col.kind, a.cells[col.key] ?? "", b.cells[col.key] ?? ""));
}

/** Rows whose cells contain the text, ignoring case. */
export function matchRows(rows: TableData["rows"], query: string | null | undefined) {
  const q = query?.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => Object.values(r.cells).some((v) => (v ?? "").toLowerCase().includes(q)));
}

export function TableWidget({ widget, data, sources, tier, building, filter }: WidgetProps<"table">) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const [page, setPage] = useState(1);
  const query = filter?.query ?? null;
  const rows = useMemo(() => (data ? matchRows(sortRows(data, sort), query) : []), [data, sort, query]);
  if (!data?.columns?.length || !data.rows?.length) return <Empty building={building} title="No rows yet" />;
  if (!rows.length) return <Empty building={false} title={`No rows match “${query}”`} description="Change the filter to see the other rows." />;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  // sw3 Table sorts the rows it is given with the column's compare. The page is already in that order, so its
  // sort leaves it as it is; compare reads the raw cell text, not the rendered cell.
  const raw = new Map(shown.map((r) => [r.id, r.cells]));

  const columns: TableColumn[] = [
    ...data.columns.map((c) => ({
      id: c.key,
      label: c.label,
      align: c.kind === "number" ? ("end" as const) : ("start" as const),
      compare: (a: { id: string }, b: { id: string }) => compare(c.kind, raw.get(a.id)?.[c.key] ?? "", raw.get(b.id)?.[c.key] ?? ""),
    })),
    { id: "__source", label: "Source" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Table
        // sw3 shows the caption. The card already carries the title, so the caption adds the count.
        caption={`${widget.title}: ${rows.length === 1 ? "1 row" : `${rows.length} rows`}`}
        columns={columns}
        sort={sort}
        onSortChange={(next) => {
          setPage(1);
          setSort(next);
        }}
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Pagination aria-label={`${widget.title} pages`} size="sm" pageCount={pageCount} page={current} onPageChange={setPage} />
        </div>
      ) : null}
    </div>
  );
}
