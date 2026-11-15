import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({ hasPendingJob: vi.fn(async () => false), lastJobCreatedAt: vi.fn(async () => null), enqueue: vi.fn(async () => 1) }));
const settings = vi.hoisted(() => ({ discoverEnabled: vi.fn(async () => false) }));
vi.mock("./repo/jobs", async (orig) => ({ ...(await orig<typeof import("./repo/jobs")>()), ...jobs }));
vi.mock("./repo/settings", () => settings);

vi.mock("./pipeline/graphs", () => ({ buildGraph: async () => {}, editGraph: async () => {}, updateGraph: async () => {}, discoverGraph: async () => {} }));
vi.mock("./monitors", () => ({ pauseBoardMonitors: async () => {}, removeBoardMonitors: async () => 0, setBoardMonitorSchedule: async () => 0 }));
vi.mock("./bus", () => ({ publish: () => {}, setBusMode: () => {}, flushRemote: async () => {} }));

import { computeTier, maybeEnqueueDiscover } from "./worker";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = 10_000 * DAY;
const base = { tier: "warm" as const, createdAt: now - 10 * DAY, lastViewedAt: now - 3 * DAY as number | null, lastChangedAt: null as number | null, situation: "ongoing" };

describe("computeTier", () => {
  it("is hot when watched, recently changed or new", () => {
    expect(computeTier({ ...base, lastViewedAt: now - MIN }, now)).toBe("hot");
    expect(computeTier({ ...base, lastChangedAt: now - 5 * MIN }, now)).toBe("hot");
    expect(computeTier({ ...base, lastChangedAt: now - 20 * MIN }, now)).toBe("warm");
    expect(computeTier({ ...base, createdAt: now - 20 * MIN }, now)).toBe("hot");
    expect(computeTier({ ...base, createdAt: now - HOUR, lastViewedAt: now - 3 * HOUR }, now)).toBe("warm");
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

describe("maybeEnqueueDiscover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISCOVER_ENABLED;
  });
  afterEach(() => {
    delete process.env.DISCOVER_ENABLED;
  });

  it("queues nothing while discovery is off in /admin (the default)", async () => {
    settings.discoverEnabled.mockResolvedValue(false);
    expect(await maybeEnqueueDiscover(now)).toBe(false);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("queues a run when an admin turned discovery on", async () => {
    settings.discoverEnabled.mockResolvedValue(true);
    expect(await maybeEnqueueDiscover(now)).toBe(true);
    expect(jobs.enqueue).toHaveBeenCalledWith("discover", expect.any(String), null, { maxAttempts: 1 });
  });

  it("DISCOVER_ENABLED=0 wins over the setting", async () => {
    settings.discoverEnabled.mockResolvedValue(true);
    process.env.DISCOVER_ENABLED = "0";
    expect(await maybeEnqueueDiscover(now)).toBe(false);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
