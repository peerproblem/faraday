export const crisisTypes = [
  "flood",
  "wildfire",
  "earthquake",
  "storm",
  "heatwave",
  "volcano",
  "other-natural-disaster",
  "cyberattack",
  "outage",
  "conflict",
  "health",
  "industrial",
  "transport",
  "other",
] as const;
export type CrisisType = (typeof crisisTypes)[number];

export const topicCategories = [...crisisTypes, "economy"] as const;
export type TopicCategory = (typeof topicCategories)[number];

export const naturalDisasterCategories = ["flood", "wildfire", "earthquake", "storm", "heatwave", "volcano", "other-natural-disaster"] as const;
export function isNaturalDisaster(category: unknown) {
  return naturalDisasterCategories.some((type) => type === category);
}

export const topicFilters = [
  "natural-disasters",
  "economy",
  ...crisisTypes.filter((category) => !isNaturalDisaster(category) && category !== "other"),
  "other",
] as const;
export type TopicFilter = TopicCategory | "natural-disasters";

export function parseTopicFilter(value: unknown): TopicFilter | null {
  return value === "natural-disasters" ? value : topicCategories.find((category) => category === value) ?? null;
}

export const situationStatuses = ["developing", "ongoing", "contained", "recovering", "resolved"] as const;
export type SituationStatus = (typeof situationStatuses)[number];

export const accents = ["red", "orange", "amber", "blue", "violet", "teal"] as const;
export type Accent = (typeof accents)[number];

export function accentFor(type: CrisisType): Accent {
  switch (type) {
    case "wildfire":
    case "heatwave":
    case "volcano":
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
  kind: "news" | "web" | "monitor" | "social";
  publishedAt: string | null;
  fetchedAt: number;
  snippet: string | null;
  /** P(on topic) from triage. Null until triaged. */
  relevance: number | null;
  sourceType: SourceType | null;
  /** Which API found it. Null on sources stored before provenance was recorded. */
  via?: SourceVia | null;
  /** Server only (stripped by publicSource): ISO 639-1 language from triage, null until known. */
  lang?: string | null;
  /** Server only (sent as the title for non-English sources): an English display title. */
  titleEn?: string | null;
};

export const sourceVias = ["contextdev", "oxylabs", "x"] as const;
export type SourceVia = (typeof sourceVias)[number];

export type BoardEvent = {
  id: number;
  ts: number;
  kind: "stage" | "update" | "change" | "edit" | "error" | "info";
  message: string;
  data: Record<string, unknown> | null;
};

export type Location = { name: string; lat: number; lon: number; zoom: number };
