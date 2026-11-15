import { incidentStatusTable, incidentTallyTable, type BoardSpecV2, type Plan, type TableSpec, type Widget } from "../spec";

const tables: TableSpec[] = [
  {
    key: incidentStatusTable,
    title: "Official incident status for this event. Use only the responsible authority's own report.",
    columns: [
      { key: "incident", label: "Incident name or stable official identifier", kind: "text" },
      { key: "incident-id", label: "Stable incident identifier if published", kind: "text" },
      { key: "region", label: "Reporting area including country", kind: "text" },
      { key: "status", label: "Explicit response status: Open, In progress, Closed to traffic, Reopened or Resolved, as reported", kind: "status" },
      { key: "status-as-of", label: "Explicit status observation time, ISO 8601 with timezone, omit if unknown", kind: "time" },
      { key: "valid-until", label: "Explicit expiry, ISO 8601 with timezone, omit if unknown", kind: "time" },
    ],
  },
  {
    key: incidentTallyTable,
    title: "Official incident totals for this event. Quote the authority's cumulative incident count, not an estimate or media count.",
    columns: [
      { key: "region", label: "Reporting area including country; use consistent names across reports", kind: "text" },
      { key: "total-incidents", label: "Exact cumulative incident count stated in the source quote", kind: "number" },
      { key: "reporting-window-start", label: "Explicit start of the reporting window, ISO 8601 with timezone, omit if unknown", kind: "time" },
      { key: "breakdown", label: 'If the report gives a complete non-overlapping breakdown of the total, record a JSON array of {"label": "Category", "value": 123}. Quote the full breakdown in the evidence. Otherwise omit.', kind: "text" },
      { key: "reporting-window-end", label: "Explicit end of the reporting window, ISO 8601 with timezone; do not use publication time", kind: "time" },
    ],
  },
];

export function withIncidentReporting(plan: Plan, spec: BoardSpecV2, reporting: { status: boolean; tally: boolean }): { plan: Plan; spec: BoardSpecV2 } {
  const selected = tables.filter((table) => table.key === incidentStatusTable ? reporting.status : reporting.tally);
  const addedTables = selected.filter((table) => !plan.tables.some((existing) => existing.key === table.key));
  const missingWidgets = selected.filter((table) => !spec.widgets.some((widget) => widget.type === "table" && widget.bind === table.key));
  const widgets = missingWidgets.map((table): Widget => ({
    id: `incident:${table.key}`,
    key: `table:${table.key}`,
    type: "table",
    title: table.key === incidentStatusTable ? "Official incident status" : "Official incident totals",
    span: "half",
    bind: table.key,
    metrics: [],
  }));
  return {
    plan: addedTables.length ? { ...plan, tables: [...plan.tables, ...addedTables] } : plan,
    spec: widgets.length ? { ...spec, widgets: [...spec.widgets, ...widgets] } : spec,
  };
}
