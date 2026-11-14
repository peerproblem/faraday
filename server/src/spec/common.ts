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
export type CrisisType = (typeof crisisTypes)[number];

export const situationStatuses = ["developing", "ongoing", "contained", "recovering", "resolved"] as const;
export type SituationStatus = (typeof situationStatuses)[number];

export const accents = ["red", "orange", "amber", "blue", "violet", "teal"] as const;
export type Accent = (typeof accents)[number];

export function accentFor(type: CrisisType): Accent {
  switch (type) {
    case "wildfire":
    case "heatwave":
      return "orange";
    case "flood":
    case "storm":
      return "blue";
    case "cyberattack":
    case "outage":
      return "violet";
    case "health":
      return "teal";
    case "industrial":
    case "transport":
      return "amber";
    default:
      return "red";
  }
}

/** Pipeline state of a board. Scheduling state lives in BoardTier. */
export type BoardStatus = "queued" | "planning" | "gathering" | "composing" | "watching" | "live" | "error";
export type BoardTier = "hot" | "warm" | "cold" | "paused";
export type Visibility = "public" | "unlisted";

export const sourceTypes = ["official", "news", "social", "aggregator", "other"] as const;
export type SourceType = (typeof sourceTypes)[number];

export type Source = {
  id: string;
  url: string;
  title: string | null;
  publisher: string | null;
  kind: "news" | "web" | "monitor";
  publishedAt: string | null;
  fetchedAt: number;
  snippet: string | null;
  /** P(on topic) from triage. Null until triaged. */
  relevance: number | null;
  sourceType: SourceType | null;
};

export type BoardEvent = {
  id: number;
  ts: number;
  kind: "stage" | "update" | "change" | "edit" | "error" | "info";
  message: string;
  data: Record<string, unknown> | null;
};

export type Location = { name: string; lat: number; lon: number; zoom: number };
