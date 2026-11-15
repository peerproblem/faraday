"use client";

import { useMemo, useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Link } from "@/components/ui/link";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Table, type TableColumn, type TableRow, type TableSort } from "@/components/ui/table";
import { Text } from "@/components/ui/typography";
import type { ColumnKind, TableData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export const PAGE_SIZE = 20;
const MAP_FOCUS_PAGE_SIZE = 4;

const num = (s: string) => {
  const m = s.replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function compare(kind: ColumnKind, a: string, b: string): number {
  if (kind === "number") {
    const left = num(a);
    const right = num(b);
    return left === right ? 0 : (left ?? -Infinity) - (right ?? -Infinity);
  }
  return a.localeCompare(b);
}

const clockPattern = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\s*(AM|PM))?(?![\d:])/i;
const datePattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2} [A-Za-z]{3,9} \d{4})\b/;

function timeOffset(value: string): number | null {
  const zone = value.match(/\b(UTC|GMT|EET|EEST)\b/i)?.[1]?.toUpperCase();
  if (zone === "EET") return 2 * 3_600_000;
  if (zone === "EEST") return 3 * 3_600_000;
  return zone ? 0 : null;
}

function tableTime(value: string, columnOffset: number) {
  const iso = value.trim().match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (iso) {
    const day = Date.parse(iso[1] + "T00:00:00Z");
    const time = Date.parse(value.trim() + (iso[2] ? "" : "Z")) - (iso[2] ? 0 : columnOffset);
    return Number.isFinite(time) ? { day, time, clock: null } : null;
  }

  const explicitDate = value.match(datePattern)?.[0];
  const parsedDay = explicitDate ? Date.parse(explicitDate + " UTC") : NaN;
  const day = Number.isFinite(parsedDay) ? parsedDay : null;
  const match = value.match(clockPattern);
  if (!match) {
    // A date without phrasing is sortable at day precision. "Same morning" and other estimates stay unknown.
    return day !== null && explicitDate === value.trim() ? { day, time: day - columnOffset, clock: null } : null;
  }
  const [, hh, mm, ss, meridiem] = match;
  const hour = Number(hh);
  if (meridiem && (hour < 1 || hour > 12)) return null;
  const hours = meridiem ? hour % 12 + (meridiem.toUpperCase() === "PM" ? 12 : 0) : hour;
  const clock = ((hours * 60 + Number(mm)) * 60 + Number(ss ?? 0)) * 1_000 - (timeOffset(value) ?? columnOffset);
  return { day, time: day === null ? null : day + clock, clock };
}

export function statusTone(v: string): BadgeVariant {
  const s = v.toLowerCase();
  if (/(closed|down|outage|critical|evacuat|destroyed|offline|blocked)/.test(s)) return "danger";
  if (/(partial|degraded|limited|warning|delayed|reduced)/.test(s)) return "warning";
  if (/(open|ok|operational|restored|resolved|normal|online)/.test(s)) return "success";
  return "neutral";
}

function Cell({ kind, value, compact }: { kind: ColumnKind; value: string; compact?: boolean }) {
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
  if (kind === "status") {
    return <Badge variant={statusTone(value)} className={compact ? "h-auto min-h-5 whitespace-normal py-0.5 leading-snug" : undefined}>{value}</Badge>;
  }
  return compact && value.length <= 16 && /^\S+$/.test(value) ? <span className="whitespace-nowrap">{value}</span> : <>{value}</>;
}

/** All rows in the table's sort order. Sorting happens here, before paging, so page 2 continues page 1. */
export function sortRows(data: TableData, sort: TableSort | null) {
  const rows = [...data.rows];
  if (!sort) return rows;
  const col = data.columns.find((c) => c.key === sort.columnId);
  if (!col) return rows;
  const dir = sort.direction === "descending" ? -1 : 1;
  const value = (row: TableData["rows"][number]) => row.cells[col.key] ?? "";
  if (col.kind !== "time") return rows.sort((a, b) => dir * compare(col.kind, value(a), value(b)));

  const offset = timeOffset(col.label) ?? 0;
  const times = new Map(rows.map((row) => [row.id, tableTime(value(row), offset)]));
  const days = new Set([...times.values()].flatMap((time) => time?.day == null ? [] : [time.day]));
  // A clock-only value can share the stated date when all dated entries identify the same day.
  const commonDay = days.size === 1 ? days.values().next().value : days.size === 0 ? 0 : undefined;
  const key = (row: TableData["rows"][number]) => {
    const time = times.get(row.id);
    if (time?.time != null) return time.time;
    return time?.clock != null && commonDay !== undefined ? commonDay + time.clock : null;
  };
  return rows.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return dir * (left - right);
  });
}

/** Rows whose cells contain the text, ignoring case. */
export function TableWidget({ widget, data, sources, tier, building, mapFocus: compact, cyberPresentation }: WidgetProps<"table">) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => (data ? sortRows(data, sort) : []), [data, sort]);
  if (!data?.columns?.length || !data.rows?.length) return <Empty building={building} title="No rows yet" />;
  const pageSize = compact ? MAP_FOCUS_PAGE_SIZE : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const shown = rows.slice(start, start + pageSize);
  // The visible page is already in the global sort order. SW3 uses compare to enable the header control.
  // When the generated table has a Citation column, use the same Source column for row citations and any fallback text.
  const citationColumn = compact ? data.columns.find((column) =>
    column.kind === "link" && /^(source|citation)$/i.test(column.label.trim()),
  ) : undefined;
  const dataColumns = data.columns.filter((column) => column !== citationColumn);
  function citationFallback(row: TableData["rows"][number]) {
    if (!citationColumn) return "";
    const value = row.cells[citationColumn.key] ?? "";
    const urls = (row.sources ?? []).map((id) => sources.get(id)?.url).filter((url) => /^https?:\/\//.test(url ?? ""));
    if (!urls.length) return value;
    return /^https?:\/\//.test(value) && !urls.includes(value) ? value : "";
  }
  const positions = new Map(shown.map((r, index) => [r.id, index]));
  const direction = sort?.direction === "descending" ? -1 : 1;

  const columns: TableColumn[] = [
    ...dataColumns.map((c) => ({
      id: c.key,
      label: compact ? c.label.replace(/,\s*cited only\s*\)/i, ")") : c.label,
      align: c.kind === "number" ? ("end" as const) : ("start" as const),
      compare: (a: TableRow, b: TableRow) => direction * ((positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0)),
    })),
    { id: "__source", label: "Source" },
  ];

  return (
    <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-4"}>
      {compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text as="span" size="sm" tone="muted" aria-live="polite">
            {start + 1}–{start + shown.length} of {rows.length} rows
          </Text>
          {pageCount > 1 && <Pagination aria-label={`${widget.title} pages`} size="sm" variant="compact" pageCount={pageCount} page={current} onPageChange={setPage} />}
        </div>
      )}
      {cyberPresentation && compact && (
        <div className="fd-cyber-records">
          <Select aria-label={`${widget.title} sort`} size="sm"
            value={sort ? `${dataColumns.findIndex(column => column.key === sort.columnId)}:${sort.direction}` : "original"}
            onValueChange={(value) => {
              const [index, direction] = (value ?? "original").split(":");
              const column = dataColumns[Number(index)];
              setSort(column && (direction === "ascending" || direction === "descending") ? { columnId: column.key, direction } : null);
              setPage(1);
            }}>
            <SelectTrigger />
            <SelectContent>
              <SelectItem value="original">Original report order</SelectItem>
              {dataColumns.flatMap((column, index) => [
                <SelectItem key={`${column.key}:asc`} value={`${index}:ascending`}>{column.label} · ascending</SelectItem>,
                <SelectItem key={`${column.key}:desc`} value={`${index}:descending`}>{column.label} · descending</SelectItem>,
              ])}
            </SelectContent>
          </Select>
          <ol aria-label={`${widget.title} records`} className="fd-cyber-record-list">
            {shown.map(row => <li key={row.id}>
              <dl>{dataColumns.map(column => <div key={column.key}>
                <dt>{column.label}</dt>
                <dd><Cell kind={column.kind} value={row.cells[column.key] ?? ""} compact /></dd>
              </div>)}</dl>
              <div className="fd-cyber-record-citations">
                {citationFallback(row) && <Cell kind="link" value={citationFallback(row)} compact />}
                <SourceChips ids={row.sources} sources={sources} evidence={row.evidence} collapseAt={4} />
                <AsOf t={row.asOf} tier={tier} prefix="" />
              </div>
            </li>)}
          </ol>
        </div>
      )}
      <div className={cyberPresentation && compact ? "fd-cyber-table-view" : "contents"}>
      <Table
        // The card already shows the title. Keep the caption as the accessible table and scroll region name.
        caption={`${widget.title}: ${rows.length === 1 ? "1 row" : `${rows.length} rows`}`}
        className={compact ? "fd-workspace-table [&>caption]:sr-only" : "[&>caption]:sr-only"}
        columns={columns}
        sort={sort}
        onSortChange={(next) => {
          setPage(1);
          setSort(next);
        }}
        rows={shown.map((r) => {
          const fallback = citationFallback(r);
          return {
            id: r.id,
            cells: {
              ...Object.fromEntries(dataColumns.map((c) => [c.key, <Cell key={c.key} kind={c.kind} compact={compact} value={r.cells[c.key] ?? ""} />])),
              __source: (
                <span className="flex flex-wrap items-center gap-1.5">
                  {fallback && <Cell kind="link" value={fallback} compact={compact} />}
                  <SourceChips ids={r.sources} sources={sources} evidence={r.evidence} />
                  <AsOf t={r.asOf} tier={tier} prefix="" />
                </span>
              ),
            },
          };
        })}
      />
      </div>
      {!compact && pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Pagination aria-label={`${widget.title} pages`} size="sm" pageCount={pageCount} page={current} onPageChange={setPage} />
        </div>
      ) : null}
    </div>
  );
}
