"use client";

import { useRef, type ReactNode } from "react";
import { Icon, useAgentBinding } from "@sw3/ui";

export type SortDirection = "ascending" | "descending" | "none";

export type DataTableColumn = {
  key: string;
  label: ReactNode;
  align?: "start" | "end";
  /** Set to make the header a sort button. */
  sort?: { direction: SortDirection; label: string; onToggle: () => void };
};

export type DataTableRow = { id: string; cells: Record<string, ReactNode> };

/** A header's sort button. Registered with the agent bridge, which does not see plain buttons outside sw3 components. */
function SortButton({ sort, children }: { sort: NonNullable<DataTableColumn["sort"]>; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useAgentBinding(ref, { kind: "button", state: () => ({ sort: sort.direction }), actions: { press: () => ref.current?.click() } });
  return (
    <button ref={ref} type="button" className="fd-table__sort" aria-label={sort.label} onClick={sort.onToggle}>
      {children}
      {sort.direction === "none" ? null : <Icon name={sort.direction === "ascending" ? "chevron-up" : "chevron-down"} aria-hidden="true" />}
    </button>
  );
}

/** Stand-in: sw3 v1 has no Table. A plain HTML table on hairlines, scrollable sideways from the keyboard. */
export function DataTable({ caption, columns, rows }: { caption: string; columns: DataTableColumn[]; rows: DataTableRow[] }) {
  return (
    <div data-fd="table" className="fd-table-scroll" role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className="fd-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-align={c.align ?? "start"} aria-sort={c.sort ? c.sort.direction : undefined}>
                {c.sort ? (
                  <SortButton sort={c.sort}>{c.label}</SortButton>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key} data-align={c.align ?? "start"}>
                  {r.cells[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
