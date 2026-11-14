import { describe, expect, it, vi } from "vitest";

vi.mock("./pipeline/graphs", () => ({ buildGraph: async () => {}, editGraph: async () => {}, updateGraph: async () => {} }));
vi.mock("./monitors", () => ({ removeBoardMonitors: async () => 0 }));
vi.mock("./bus", () => ({ publish: () => {}, setBusMode: () => {}, flushRemote: async () => {} }));

import { computeTier } from "./worker";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = 10_000 * DAY;
const base = { tier: "warm" as const, createdAt: now - 10 * DAY, lastViewedAt: now - 3 * DAY as number | null, lastChangedAt: null as number | null, situation: "ongoing" };

describe("computeTier", () => {
  it("is hot when watched, recently changed or new", () => {
    expect(computeTier({ ...base, lastViewedAt: now - MIN }, now)).toBe("hot");
    expect(computeTier({ ...base, lastChangedAt: now - 20 * MIN }, now)).toBe("hot");
    expect(computeTier({ ...base, createdAt: now - HOUR }, now)).toBe("hot");
  });
  it("is warm within a day of a view or change", () => {
    expect(computeTier({ ...base, lastViewedAt: now - 3 * HOUR }, now)).toBe("warm");
    expect(computeTier({ ...base, lastChangedAt: now - 20 * HOUR }, now)).toBe("warm");
  });
  it("is cold otherwise", () => {
    expect(computeTier({ ...base, lastViewedAt: now - 3 * DAY }, now)).toBe("cold");
  });
  it("pauses after a week without views, or when resolved and quiet", () => {
    expect(computeTier({ ...base, lastViewedAt: now - 8 * DAY }, now)).toBe("paused");
    expect(computeTier({ ...base, lastViewedAt: null }, now)).toBe("paused");
    expect(computeTier({ ...base, situation: "resolved", lastViewedAt: now - HOUR, lastChangedAt: now - 3 * DAY }, now)).toBe("paused");
    expect(computeTier({ ...base, situation: "resolved", lastChangedAt: now - 10 * MIN }, now)).toBe("hot");
  });
  it("keeps paused boards paused", () => {
    expect(computeTier({ ...base, tier: "paused", lastViewedAt: now }, now)).toBe("paused");
  });
});
