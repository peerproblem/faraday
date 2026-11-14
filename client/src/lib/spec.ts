import { z } from "zod";

export const crisisTypes = [
  "flood",
  "wildfire",
  "earthquake",
  "storm",
  "heatwave",
  "cyberattack",
  "outage",
  "conflict",
  "health",
  "industrial",
  "transport",
  "other",
] as const;

export const sectionTypes = [
  "summary",
  "kpis",
  "map",
  "timeline",
  "table",
  "advisories",
  "help",
  "news",
  "changes",
  "sources",
] as const;

const sources = z.array(z.string()).describe("Source ids like s3 that support this item");

export const kpiSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string().describe("The figure as stated by the source, e.g. '12,400' or '3 of 7'"),
  unit: z.string().nullable(),
  delta: z.string().nullable().describe("Change since the previous figure, if a source states it"),
  tone: z.enum(["critical", "warning", "info", "ok"]),
  sources,
});

export const timelineEventSchema = z.object({
  id: z.string(),
  at: z.string().nullable().describe("ISO 8601 time of the event, null if unknown"),
  title: z.string(),
  detail: z.string(),
  importance: z.enum(["high", "medium", "low"]),
  sources,
});

export const mapPointSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  kind: z.enum(["impact", "incident", "shelter", "closure", "resource", "origin"]),
  note: z.string(),
  sources,
});

export const tableSchema = z.object({
  id: z.string(),
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  sources,
});

export const advisorySchema = z.object({
  id: z.string(),
  issuer: z.string(),
  title: z.string(),
  text: z.string(),
  level: z.enum(["warning", "watch", "info"]),
  url: z.string().nullable(),
  sources,
});

export const helpLinkSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  kind: z.enum(["official", "donate", "shelter", "hotline", "volunteer", "info"]),
  note: z.string(),
});

export const sectionSchema = z.object({
  type: z.enum(sectionTypes),
  title: z.string(),
  tableId: z.string().nullable().describe("Only for type=table: which table to show"),
});

export const boardSpecSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  crisisType: z.enum(crisisTypes),
  status: z.enum(["developing", "ongoing", "contained", "recovering", "resolved"]),
  severity: z.number().int().min(1).max(5),
  headline: z.string().describe("One sentence: the state of things right now"),
  location: z
    .object({ name: z.string(), lat: z.number(), lon: z.number(), zoom: z.number() })
    .nullable(),
  summary: z.object({ text: z.string(), sources }),
  kpis: z.array(kpiSchema),
  timeline: z.array(timelineEventSchema),
  mapPoints: z.array(mapPointSchema),
  tables: z.array(tableSchema),
  advisories: z.array(advisorySchema),
  help: z.array(helpLinkSchema),
  layout: z.array(sectionSchema),
  accent: z.enum(["red", "orange", "amber", "blue", "violet", "teal"]),
});

export type BoardSpec = z.infer<typeof boardSpecSchema>;
export type Kpi = z.infer<typeof kpiSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type MapPoint = z.infer<typeof mapPointSchema>;
export type DataTable = z.infer<typeof tableSchema>;
export type Advisory = z.infer<typeof advisorySchema>;
export type HelpLink = z.infer<typeof helpLinkSchema>;
export type Section = z.infer<typeof sectionSchema>;

export type Source = {
  id: string;
  url: string;
  title: string | null;
  publisher: string | null;
  kind: "news" | "web" | "monitor";
  publishedAt: string | null;
  fetchedAt: number;
  snippet: string | null;
};

export type BoardEvent = {
  id: number;
  ts: number;
  kind: "stage" | "update" | "change" | "edit" | "error" | "info";
  message: string;
  data: Record<string, unknown> | null;
};

export type StageMetric = { stage: string; ms: number; detail: string };

export type BoardMetrics = {
  stages: StageMetric[];
  contextCalls: number;
  llmCalls: number;
  sourcesRead: number;
};

export type BoardStatus = "queued" | "planning" | "gathering" | "composing" | "watching" | "live" | "error";

export type BoardView = {
  id: string;
  slug: string;
  prompt: string;
  title: string | null;
  status: BoardStatus;
  spec: BoardSpec | null;
  version: number;
  metrics: BoardMetrics | null;
  sources: Source[];
  events: BoardEvent[];
  createdAt: number;
  updatedAt: number;
  lastPolledAt: number | null;
  ownerId: string | null;
  plan: Record<string, unknown> | null;
  messages: { role: "user" | "assistant"; content: string; ts: number }[];
};
