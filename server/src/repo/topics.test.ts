import { describe, expect, it, vi } from "vitest";
import { allowanceAt, allowanceFor, candidateScore, fingerprint, topicRank, TYPE_BOOST } from "./topics";
import { mayBeSameEvent, topicPrompt } from "../pipeline/discover/judge";
import { normalizeClusters } from "../pipeline/discover/cluster";
import { crisisTypes } from "../spec";

const HOUR = 3_600_000;
const now = 1_800_000_000_000;

describe("topic scoring", () => {
  it("weights outlets, recency and spread by crisis type", () => {
    expect(candidateScore({ crisisType: "flood", publishers: 8, articles: 15, newestAt: now }, now)).toBeCloseTo(1, 6);
    expect(candidateScore({ crisisType: "other", publishers: 8, articles: 15, newestAt: now }, now)).toBeCloseTo(0.6, 6);
    expect(candidateScore({ crisisType: "flood", publishers: 2, articles: 2, newestAt: now - 12 * HOUR }, now)).toBeCloseTo(
      0.5 * 0.25 + 0.3 * Math.exp(-1) + 0.2 * (2 / 15),
      6,
    );
    expect(candidateScore({ crisisType: "flood", publishers: 0, articles: 0, newestAt: null }, now)).toBe(0);
    for (const t of crisisTypes) expect(TYPE_BOOST[t]).toBeGreaterThan(0);
  });

  it("ranks topics from severity, last change, outlets and last view", () => {
    expect(topicRank({ severity: 5, lastChangedAt: now, publishers: 20, lastViewedAt: now }, now)).toBeCloseTo(1, 6);
    expect(topicRank({ severity: null, lastChangedAt: null, publishers: 0, lastViewedAt: null }, now)).toBe(0);
    expect(topicRank({ severity: 3, lastChangedAt: now - 24 * HOUR, publishers: 10, lastViewedAt: null }, now)).toBeCloseTo(
      0.4 * 0.6 + 0.3 * Math.exp(-1) + 0.2 * 0.5,
      6,
    );
  });

  it("gives monitors by rank position", () => {
    const l = { monitored: 10, page: 5 };
    expect(allowanceAt(0, l)).toEqual({ search: true, page: true });
    expect(allowanceAt(5, l)).toEqual({ search: true, page: false });
    expect(allowanceAt(10, l)).toEqual({ search: false, page: false });
    expect(allowanceAt(-1, l)).toEqual({ search: false, page: false });
  });

  it("keeps search monitoring for a priority topic outside the ranked allocation", () => {
    vi.stubEnv("FARADAY_PRIORITY_SEARCH_MONITOR_BOARD_IDS", "other-board, finland-board");
    vi.stubEnv("MONITORED_TOPICS", "5");
    vi.stubEnv("PAGE_MONITORED_TOPICS", "2");
    try {
      expect(allowanceFor("finland-board", 8)).toEqual({ search: true, page: false });
      expect(allowanceFor("finland-board", -1)).toEqual({ search: false, page: false });
      expect(allowanceFor("normal-board", 8)).toEqual({ search: false, page: false });
      expect(allowanceFor("normal-board", 0)).toEqual({ search: true, page: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fingerprints by crisis type and place, ignoring case, accents and punctuation", () => {
    const a = fingerprint({ crisisType: "flood", locationName: "València, Spain", entities: ["x"] });
    expect(fingerprint({ crisisType: "flood", locationName: "valencia spain", entities: ["y"] })).toBe(a);
    expect(fingerprint({ crisisType: "storm", locationName: "Valencia, Spain", entities: [] })).not.toBe(a);
    expect(fingerprint({ crisisType: "cyberattack", locationName: null, entities: ["Acme Health"] })).toBe(
      fingerprint({ crisisType: "cyberattack", locationName: null, entities: ["ACME health", "other"] }),
    );
  });
});

describe("discover helpers", () => {
  const topic = { id: "t", title: "T", crisisType: "flood", locationName: "Valencia, Spain", entities: ["Turia", "Valencia"], topicState: "active" as const, headline: null };
  it("pre-filters pairs by a shared place or name, whatever the crisis type", () => {
    expect(mayBeSameEvent({ crisisType: "flood", locationName: "valencia, spain", entities: [] }, topic)).toBe(true);
    expect(mayBeSameEvent({ crisisType: "flood", locationName: "Alzira", entities: ["Turia"] }, topic)).toBe(true);
    // The same storm can be labelled differently between runs; the sameEvent model decides.
    expect(mayBeSameEvent({ crisisType: "storm", locationName: "Valencia, Spain", entities: [] }, topic)).toBe(true);
    expect(mayBeSameEvent({ crisisType: "wildfire", locationName: "Madrid", entities: ["Turia"] }, topic)).toBe(true);
    expect(mayBeSameEvent({ crisisType: "flood", locationName: "Lisbon", entities: ["Tagus"] }, topic)).toBe(false);
  });

  it("writes the English topic prompt", () => {
    expect(topicPrompt({ title: "Acme ransomware attack.", crisisType: "cyberattack", locationName: null, entities: [] })).toBe(
      "Acme ransomware attack. Cyberattack. Track casualties, displacement, official advisories and help resources.",
    );
    expect(topicPrompt({ title: "Valencia floods", crisisType: "other", locationName: "Valencia", entities: ["A", "B"] })).toBe(
      "Valencia floods. Crisis in Valencia. Track casualties, displacement, official advisories and help resources. Key names: A, B.",
    );
  });

  it("drops invented, repeated or shared article indexes and empty events", () => {
    const out = normalizeClusters(
      [
        { title: "A", crisisType: "flood", locationName: " ", entities: ["x", "x", " "], articleIdx: [0, 1, 1, 9], ongoing: true },
        { title: "B", crisisType: "storm", locationName: "Here", entities: [], articleIdx: [1, 2], ongoing: false },
        { title: "C", crisisType: "storm", locationName: null, entities: [], articleIdx: [5], ongoing: true },
      ],
      3,
    );
    expect(out).toEqual([
      { title: "A", crisisType: "flood", locationName: null, entities: ["x"], articleIdx: [0, 1], ongoing: true },
      { title: "B", crisisType: "storm", locationName: "Here", entities: [], articleIdx: [2], ongoing: false },
    ]);
  });
});
