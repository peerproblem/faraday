// Discovery decisions: is a candidate the same event as an existing topic, and does it deserve a live board.
import { decide } from "../../llm/decide";
import type { Usage } from "../../graph/runner";
import type { TopicRow } from "../../repo/topics";
import { normName } from "../../repo/topics";
import type { Cluster } from "./cluster";

export type CandidateView = Pick<Cluster, "title" | "crisisType" | "locationName" | "entities"> & { headlines: string[] };

const SAME_EVENT = {
  same: {
    type: "boolean" as const,
    instructions: "Do the candidate and the existing topic describe the same real-world crisis event (same incident, same place, same period)?",
    criteria: {
      true: "Same incident, or a direct continuation of it (aftershocks, a spreading fire, the same storm moving on)",
      false: "A similar but separate event: another place, another incident, or another time",
    },
  },
};

const NEEDS_BOARD = {
  live: {
    type: "boolean" as const,
    instructions:
      "Is this an ongoing crisis that is harming people or infrastructure now, where the people affected would use a live situation board (figures, warnings, help resources)?",
    criteria: {
      true: "An unfolding disaster, outage, cyberattack, outbreak, conflict or accident with people affected now",
      false: "Politics, markets, opinion, a minor incident, or an event that is already over",
    },
  },
};

/**
 * Cheap first pass before asking the model: the entities overlap or the place matches, whatever the crisis type.
 */
export function mayBeSameEvent(c: Pick<Cluster, "crisisType" | "locationName" | "entities">, t: TopicRow): boolean {
  // The crisis type is not a filter: the same hurricane can be labelled "storm" in one run and "flood" in the next.
  // A shared place or name is enough to ask the sameEvent model, and MAX_PAIRS bounds how often that happens.
  const place = normName(c.locationName);
  if (place && place === normName(t.locationName)) return true;
  const ents = new Set(c.entities.map(normName).filter(Boolean));
  return t.entities.some((e) => ents.has(normName(e)));
}

export async function sameEventProbability(c: CandidateView, t: TopicRow, use: Usage, signal: AbortSignal): Promise<number> {
  const r = await decide(
    {
      candidate: { title: c.title, crisisType: c.crisisType, place: c.locationName, entities: c.entities, headlines: c.headlines.slice(0, 6) },
      existingTopic: { title: t.title, crisisType: t.crisisType, place: t.locationName, entities: t.entities, headline: t.headline },
    },
    SAME_EVENT,
    { signal },
  );
  use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
  return r.answers.same.probability;
}

export async function needsBoardProbability(c: CandidateView, use: Usage, signal: AbortSignal): Promise<number> {
  const r = await decide(
    { candidate: { title: c.title, crisisType: c.crisisType, place: c.locationName, entities: c.entities, headlines: c.headlines.slice(0, 8) } },
    NEEDS_BOARD,
    { signal },
  );
  use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
  return r.answers.live.probability;
}

/** The English prompt a discovered topic is built from (spec 5.3). */
export function topicPrompt(c: Pick<Cluster, "title" | "crisisType" | "locationName" | "entities">): string {
  const kind = c.crisisType === "other" ? "Crisis" : c.crisisType[0].toUpperCase() + c.crisisType.slice(1);
  const where = c.locationName ? ` in ${c.locationName}` : "";
  const names = c.entities.length ? ` Key names: ${c.entities.join(", ")}.` : "";
  return `${c.title.replace(/[.\s]+$/, "")}. ${kind}${where}. Track casualties, displacement, official advisories and help resources.${names}`;
}
