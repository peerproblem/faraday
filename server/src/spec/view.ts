import type { BoardEvent, BoardStatus, BoardTier, Source, Visibility } from "./common";
import type { Plan } from "./plan";
import type { BoardData, BoardSpecV2, HeaderData, WidgetData } from "./widgets";

export type BoardMessage = { role: "user" | "assistant"; content: string; ts: number };

/** "system": a shared topic the discover job (or an admin) made. "user": a legacy board made from a prompt. */
export type BoardOrigin = "system" | "user";
export type TopicState = "active" | "archived" | "merged";

/** GET /api/boards/:id and /api/boards/by-slug/:slug */
export type BoardView = {
  id: string;
  slug: string;
  prompt: string;
  title: string | null;
  status: BoardStatus;
  tier: BoardTier;
  visibility: Visibility;
  /** 1 means an old board that is waiting to be rebuilt; spec and data are null then. */
  specVersion: number;
  spec: BoardSpecV2 | null;
  data: BoardData | null;
  version: number;
  sources: Source[];
  events: BoardEvent[];
  createdAt: number;
  updatedAt: number;
  lastPolledAt: number | null;
  ownerId: string | null;
  plan: Plan | null;
  messages: BoardMessage[];
  language: string | null;
  origin: BoardOrigin;
  topicState: TopicState | null;
};

/** GET /api/boards, GET /api/topics */
export type BoardCard = {
  id: string;
  slug: string;
  title: string | null;
  prompt: string;
  status: BoardStatus;
  tier: BoardTier;
  updatedAt: number;
  crisisType: string | null;
  severity: number | null;
  headline: string | null;
  accent: string | null;
  origin: BoardOrigin;
  topicState: TopicState | null;
  /** Home ranking for shared topics, 0 to 1. Null until the scheduler has scored it. */
  rankScore: number | null;
  locationName: string | null;
};

export type RunStepView = {
  node: string;
  stepKey: string;
  status: "running" | "done" | "failed" | "skipped";
  attempt: number;
  startedAt: number;
  ms: number | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  contextCalls: number | null;
  error: string | null;
};

/** GET /api/boards/:id/runs/latest */
export type RunView = {
  run: { id: number; graph: "build" | "edit" | "update" | "discover"; status: "running" | "done" | "failed"; startedAt: number; finishedAt: number | null; error: string | null } | null;
  steps: RunStepView[];
  totals: { ms: number | null; llmCalls: number; tokensIn: number; tokensOut: number; contextCalls: number };
};

/** Server-Sent Events on GET /api/boards/:id/stream. The SSE `data:` line is JSON of one of these. */
export type StreamMsg =
  | { type: "hello"; version: number; lastPolledAt?: number | null }
  | { type: "polled"; lastPolledAt: number }
  | { type: "status"; status: BoardStatus; tier: BoardTier }
  | { type: "spec"; version: number; spec: BoardSpecV2 }
  | { type: "data"; version: number; header?: HeaderData; widgets: Record<string, WidgetData>; hidden?: string[] }
  | { type: "sources"; added: Source[]; discarded: string[] }
  | { type: "event"; event: BoardEvent }
  /** Not stored. Shown while a build or edit runs. */
  | { type: "partial"; stage?: string; spec?: BoardSpecV2; header?: Partial<HeaderData>; widgets?: Record<string, WidgetData> };
