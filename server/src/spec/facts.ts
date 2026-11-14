import type { ColumnKind, MapPointKind, ResourceKind, ServiceState } from "./widgets";

export const factKinds = ["metric", "event", "place", "advisory", "resource", "row", "status"] as const;
export type FactKind = (typeof factKinds)[number];

export type MetricPayload = { valueText: string; valueNum: number | null; unit: string | null; scope: string | null };
export type EventPayload = { title: string; detail: string; importance: "high" | "medium" | "low" };
/** lat and lon are filled by geocoding, never by a model. */
export type PlacePayload = { name: string; placeKind: MapPointKind; note: string; lat?: number | null; lon?: number | null };
export type AdvisoryPayload = { issuer: string; title: string; text: string; level: "warning" | "watch" | "info"; url: string | null; active: boolean };
export type ResourcePayload = { label: string; url: string; resourceKind: ResourceKind; note: string };
export type RowPayload = { table: string; cells: Record<string, string> };
export type StatusPayload = { group: string; name: string; state: ServiceState; note: string };

export type PayloadMap = {
  metric: MetricPayload;
  event: EventPayload;
  place: PlacePayload;
  advisory: AdvisoryPayload;
  resource: ResourcePayload;
  row: RowPayload;
  status: StatusPayload;
};

/**
 * `key` semantics (fkey stored in the DB is `${kind}:${key}`):
 * - metric: a metric key from the plan, or `new:<suggested-key>`
 * - row: `<tableKey>:<row-slug>` (row-slug is the kebab-case first cell)
 * - status: `<groupKey>:<name-slug>`
 * - event, place, advisory, resource: kebab-case slug of the title, name or label
 */
export type ExtractedFact<K extends FactKind = FactKind> = {
  kind: K;
  key: string;
  sourceId: string;
  /** Verbatim sentence from the source, at most 300 characters. */
  quote: string;
  asOf: string | null;
  payload: PayloadMap[K];
};

/** An extracted fact that passed verification, ready to merge. */
export type StagedFact = ExtractedFact & {
  sourceType: import("./common").SourceType | null;
  relevance: number | null;
  /** Filled by verify for metrics: the number parsed from the quote. */
  valueNum: number | null;
};

export type FactStatus = "active" | "superseded" | "retracted" | "rejected";

export type Fact<K extends FactKind = FactKind> = {
  id: number;
  boardId: string;
  kind: K;
  key: string;
  payload: PayloadMap[K];
  valueNum: number | null;
  asOf: string | null;
  sourceIds: string[];
  quote: string | null;
  /** English translation of `quote`, written after verification for sources that are not in English. */
  quoteEn?: string | null;
  verified: boolean;
  status: FactStatus;
  supersededBy: number | null;
  runId: number | null;
  createdAt: number;
};

export type FactDiff = {
  added: { kind: FactKind; key: string }[];
  changed: { kind: FactKind; key: string; from: string | null; to: string }[];
  superseded: number;
};

export type { ColumnKind };
