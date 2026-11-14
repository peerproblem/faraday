import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCtx } from "../../graph/runner";
import type { FoundDoc } from "../../repo/boards";
import type { CandidateRecord, TopicRow } from "../../repo/topics";

vi.mock("ai", () => ({ generateText: vi.fn(), Output: { object: (x: unknown) => x } }));
vi.mock("../../llm/decide", () => ({ decide: vi.fn() }));
vi.mock("../../llm/models", () => ({ fastLlm: () => ({ model: "fast-model", modelId: "fast" }) }));
vi.mock("../../repo/boards", () => ({
  createBoard: vi.fn(async () => ({ id: "newtopic", slug: "valencia-floods-abcde" })),
  addSources: vi.fn(async (_id: string, docs: FoundDoc[]) => docs.map((d, i) => ({ id: `s${i + 1}`, url: d.url }))),
}));
vi.mock("../../repo/jobs", () => ({ enqueue: vi.fn(async () => 1) }));
const settings = vi.hoisted(() => ({ discoverEnabled: vi.fn(async () => true) }));
vi.mock("../../repo/settings", () => settings);
const recorded: CandidateRecord[] = [];
let topics: TopicRow[] = [];
let rejected = new Set<string>();
let discoveredToday = 0;
let activeCount = 0;
vi.mock("../../repo/topics", async (orig) => ({
  ...(await orig<typeof import("../../repo/topics")>()),
  lastDiscoverAt: vi.fn(async () => null),
  recentlyRejected: vi.fn(async () => rejected),
  matchableTopics: vi.fn(async () => topics.map((t) => ({ ...t }))),
  countActiveTopics: vi.fn(async () => activeCount),
  countDiscoveredSince: vi.fn(async () => discoveredToday),
  reactivateTopic: vi.fn(async () => true),
  recordCandidates: vi.fn(async (rows: CandidateRecord[]) => void recorded.push(...rows)),
}));

const ai = await import("ai");
const { decide } = await import("../../llm/decide");
const boards = await import("../../repo/boards");
const jobs = await import("../../repo/jobs");
const repoTopics = await import("../../repo/topics");
const { cassetteKey } = await import("../../contextdev");
const { DISCOVERY_QUERIES } = await import("../discover/cluster");
const { discoverGraph, buildCandidates } = await import("./discover");

const NOW = Date.parse("2026-11-14T12:00:00Z");
const HOUR = 3_600_000;

// Eight outlets on the Valencia floods, two on a minor local story, from the recorded news search cassettes.
const valencia = Array.from({ length: 8 }, (_, i) => ({
  url: `https://outlet${i}.example/valencia-floods`,
  title: `Valencia floods: evacuations widen (${i})`,
  publisher: `Outlet ${i}`,
  publishedAt: new Date(NOW - (i + 1) * HOUR).toISOString(),
  snippet: "Rivers burst their banks around Valencia and thousands were evacuated.",
  kind: "news",
}));
const minor = [0, 1].map((i) => ({
  url: `https://local${i}.example/street-flooding`,
  title: "Street flooding after a burst pipe",
  publisher: `Local ${i}`,
  publishedAt: new Date(NOW - 30 * HOUR).toISOString(),
  snippet: "A burst water main flooded a street.",
  kind: "news",
}));

let dir: string;
async function tape(results: Record<string, unknown[]>) {
  // Same args the scan sends: query, window start rounded to the hour, limit.
  const from = Math.floor((NOW - 25 * HOUR) / HOUR) * HOUR;
  for (const q of DISCOVERY_QUERIES) {
    const args = [q, from, 20];
    await writeFile(path.join(dir, `${cassetteKey("news.search", args)}.json`), JSON.stringify({ method: "news.search", args, result: results[q] ?? [] }));
  }
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "faraday-discover-"));
  process.env.EVAL_CASSETTE_DIR = dir;
  process.env.EVAL_REPLAY = "1";
});
afterAll(async () => {
  delete process.env.EVAL_REPLAY;
  delete process.env.EVAL_CASSETTE_DIR;
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function fakeCtx() {
  const steps: string[] = [];
  const use = { llm: vi.fn(), context: vi.fn() };
  const signal = new AbortController().signal;
  const ctx: RunCtx = {
    boardId: "__system__",
    runId: 42,
    job: { id: 9, kind: "discover", boardId: "__system__", payload: null, status: "running", priority: 5, attempts: 1, maxAttempts: 1, runAfter: 0, createdAt: 0 },
    signal,
    deadline: Date.now() + 600_000,
    async step(node, input, fn, opts) {
      steps.push(opts.key ? `${node}[${opts.key}]` : node);
      try {
        return await fn(input, use, signal);
      } catch (e) {
        if (opts.optional) return opts.fallback as never;
        throw e;
      }
    },
    map: (items, _l, fn) => Promise.all(items.map(fn)),
    // The SYSTEM board has no row: the graph must not write events or stream.
    emit: () => {
      throw new Error("discover must not emit");
    },
    event: async () => {
      throw new Error("discover must not write events");
    },
  };
  return { ctx, steps, use };
}

type Ev = { title: string; crisisType: string; locationName: string | null; entities: string[]; articleIdx: number[]; ongoing: boolean };
const clusterOut = (events: Ev[]) => vi.mocked(ai.generateText).mockResolvedValue({ output: { events }, usage: { inputTokens: 100, outputTokens: 20 } } as never);
const VALENCIA: Ev = { title: "Valencia floods", crisisType: "flood", locationName: "Valencia, Spain", entities: ["Valencia", "Turia"], articleIdx: [0, 1, 2, 3, 4, 5, 6, 7], ongoing: true };
const answer = (key: string, p: number) => ({ answers: { [key]: { type: "boolean", probability: p } }, backend: "google", model: "d", ms: 1, tokensIn: 3 });
function decisions(o: { same?: number | Error; live?: number }) {
  vi.mocked(decide).mockImplementation((async (_s: unknown, q: Record<string, unknown>) => {
    if ("same" in q) {
      if (o.same instanceof Error) throw o.same;
      return answer("same", o.same ?? 0);
    }
    if ("live" in q) return answer("live", o.live ?? 0);
    throw new Error(`unexpected decision ${Object.keys(q)}`);
  }) as never);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  recorded.length = 0;
  topics = [];
  rejected = new Set();
  discoveredToday = 0;
  activeCount = 0;
  delete process.env.MAX_NEW_TOPICS_PER_RUN;
  await tape({ [DISCOVERY_QUERIES[0]]: [...valencia, valencia[0]], [DISCOVERY_QUERIES[1]]: minor });
});

describe("discoverGraph", () => {
  it("replays the scan from cassettes and creates a public system topic from an English prompt", async () => {
    clusterOut([VALENCIA]);
    decisions({ live: 0.92 });
    const { ctx, steps } = fakeCtx();
    await discoverGraph(ctx);

    expect(steps).toEqual(["scan", "cluster", `gate[${recorded[0].fingerprint.slice(0, 16)}]`, `create[${recorded[0].fingerprint.slice(0, 16)}]`, "record"]);
    // The duplicate URL from the scan is dropped before clustering.
    const prompt = vi.mocked(ai.generateText).mock.calls[0][0] as unknown as { prompt: string };
    expect(prompt.prompt.split("\n\n")).toHaveLength(10);
    expect(boards.createBoard).toHaveBeenCalledWith(
      "Valencia floods. Flood in Valencia, Spain. Track casualties, displacement, official advisories and help resources. Key names: Valencia, Turia.",
      null,
      { origin: "system", entities: ["Valencia", "Turia"], locationName: "Valencia, Spain", discoveredAt: NOW },
    );
    expect(vi.mocked(boards.addSources).mock.calls[0][0]).toBe("newtopic");
    expect(vi.mocked(boards.addSources).mock.calls[0][1]).toHaveLength(8);
    expect(jobs.enqueue).toHaveBeenCalledWith("build", "newtopic", {});
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ runId: 42, decision: "created", boardId: "newtopic", crisisType: "flood" });
    expect(recorded[0].evidence).toHaveLength(8);
    expect(recorded[0].score).toBeGreaterThan(0.6);
  });

  it("routes a candidate that matches an existing topic instead of creating one", async () => {
    clusterOut([VALENCIA]);
    decisions({ same: 0.85, live: 0.99 });
    topics = [{ id: "t1", title: "Valencia Floods", crisisType: "flood", locationName: "Valencia, Spain", entities: ["Valencia"], topicState: "active", headline: null }];
    await discoverGraph(fakeCtx().ctx);

    expect(boards.createBoard).not.toHaveBeenCalled();
    expect(vi.mocked(boards.addSources).mock.calls[0][0]).toBe("t1");
    expect(jobs.enqueue).toHaveBeenCalledWith("poll", "t1", { reason: "discover" });
    expect(repoTopics.reactivateTopic).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({ decision: "matched", boardId: "t1" });
    // The gate is not asked once the event matched.
    expect(vi.mocked(decide).mock.calls.every(([, q]) => "same" in (q as object))).toBe(true);
  });

  it("brings an archived topic back when the event flares up again", async () => {
    clusterOut([VALENCIA]);
    decisions({ same: 0.8 });
    topics = [{ id: "t1", title: "Valencia Floods", crisisType: "flood", locationName: "Valencia, Spain", entities: [], topicState: "archived", headline: null }];
    await discoverGraph(fakeCtx().ctx);
    expect(repoTopics.reactivateTopic).toHaveBeenCalledWith("t1", NOW);
    expect(recorded[0].reason).toContain("topic reactivated");
  });

  it("compares topics that share a place or a name whatever their crisis type, and matches the same event", async () => {
    clusterOut([VALENCIA]);
    decisions({ same: 0.9, live: 0.9 });
    topics = [
      // The same event labelled "storm" by an earlier run.
      { id: "storm", title: "Valencia storm", crisisType: "storm", locationName: "Valencia, Spain", entities: ["Valencia"], topicState: "active", headline: null },
      { id: "elsewhere", title: "Po floods", crisisType: "flood", locationName: "Po Valley, Italy", entities: ["Po"], topicState: "active", headline: null },
    ];
    await discoverGraph(fakeCtx().ctx);
    const sameCalls = vi.mocked(decide).mock.calls.filter(([, q]) => "same" in (q as object));
    expect(sameCalls).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ decision: "matched", boardId: "storm" });
    expect(boards.createBoard).not.toHaveBeenCalled();
  });

  it("asks the same-type topic first when several share the place", async () => {
    clusterOut([VALENCIA]);
    const asked: string[] = [];
    vi.mocked(decide).mockImplementation((async (s: unknown, q: Record<string, unknown>) => {
      if ("same" in q) {
        asked.push((s as { existingTopic: { title: string } }).existingTopic.title);
        return answer("same", 0.1);
      }
      return answer("live", 0.9);
    }) as never);
    topics = [
      { id: "fire", title: "Valencia wildfire", crisisType: "wildfire", locationName: "Valencia, Spain", entities: ["Valencia"], topicState: "active", headline: null },
      { id: "flood", title: "Valencia river floods", crisisType: "flood", locationName: "Valencia, Spain", entities: ["Turia"], topicState: "active", headline: null },
    ];
    await discoverGraph(fakeCtx().ctx);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe("Valencia river floods");
  });

  it("does nothing while discovery is off: no search, no model call, no candidates", async () => {
    settings.discoverEnabled.mockResolvedValueOnce(false);
    clusterOut([VALENCIA]);
    decisions({ same: 0.9, live: 0.9 });
    const { ctx, steps } = fakeCtx();
    await discoverGraph(ctx);
    expect(steps).toEqual([]);
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(repoTopics.recordCandidates).not.toHaveBeenCalled();
    expect(boards.createBoard).not.toHaveBeenCalled();
  });

  it("defers when the comparison fails, and rejects what the gate turns down", async () => {
    clusterOut([VALENCIA]);
    decisions({ same: new Error("decision backend down") });
    topics = [{ id: "t1", title: "Valencia Floods", crisisType: "flood", locationName: "Valencia, Spain", entities: [], topicState: "active", headline: null }];
    await discoverGraph(fakeCtx().ctx);
    expect(recorded[0]).toMatchObject({ decision: "deferred", reason: "could not compare with existing topics" });
    expect(boards.createBoard).not.toHaveBeenCalled();

    recorded.length = 0;
    topics = [];
    decisions({ live: 0.4 });
    await discoverGraph(fakeCtx().ctx);
    expect(recorded[0].decision).toBe("rejected");
    expect(recorded[0].reason).toMatch(/needs a live board \(p=0\.40\)/);
    expect(boards.createBoard).not.toHaveBeenCalled();
  });

  it("rejects weak or finished events without asking the model, and skips a recent rejection", async () => {
    clusterOut([
      { title: "Street flooding", crisisType: "flood", locationName: "Leeds, UK", entities: ["Leeds"], articleIdx: [8, 9], ongoing: true },
      { ...VALENCIA, ongoing: false },
    ]);
    decisions({ live: 0.99 });
    await discoverGraph(fakeCtx().ctx);
    expect(decide).not.toHaveBeenCalled();
    expect(recorded.map((r) => [r.title, r.decision])).toEqual([
      ["Valencia floods", "rejected"],
      ["Street flooding", "rejected"],
    ]);
    expect(recorded[0].reason).toBe("the event is over");
    expect(recorded[1].reason).toMatch(/below 0\.35/);

    recorded.length = 0;
    clusterOut([VALENCIA]);
    rejected = new Set([repoTopics.fingerprint(VALENCIA)]);
    await discoverGraph(fakeCtx().ctx);
    expect(decide).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({ decision: "rejected", reason: `${repoTopics.SKIPPED_PREFIX}rejected in the last 24 hours` });
  });

  it("keeps to the per-run, daily and active limits", async () => {
    const second: Ev = { title: "Lisbon floods", crisisType: "flood", locationName: "Lisbon, Portugal", entities: ["Lisbon"], articleIdx: [4, 5, 6, 7], ongoing: true };
    clusterOut([{ ...VALENCIA, articleIdx: [0, 1, 2, 3] }, second]);
    decisions({ live: 0.95 });
    process.env.MAX_NEW_TOPICS_PER_RUN = "1";
    await discoverGraph(fakeCtx().ctx);
    expect(boards.createBoard).toHaveBeenCalledTimes(1);
    expect(recorded.map((r) => r.decision)).toEqual(["created", "deferred"]);
    expect(recorded[1].reason).toBe("run limit of 1 new topics reached");

    vi.clearAllMocks();
    recorded.length = 0;
    delete process.env.MAX_NEW_TOPICS_PER_RUN;
    discoveredToday = 10;
    await discoverGraph(fakeCtx().ctx);
    expect(boards.createBoard).not.toHaveBeenCalled();
    expect(recorded.every((r) => r.reason === "daily limit of 10 new topics reached")).toBe(true);

    recorded.length = 0;
    discoveredToday = 0;
    activeCount = 30;
    await discoverGraph(fakeCtx().ctx);
    expect(boards.createBoard).not.toHaveBeenCalled();
    expect(recorded.every((r) => r.reason === "30 active topics already")).toBe(true);
  });

  it("does not make two topics for one event in the same run", async () => {
    clusterOut([
      { ...VALENCIA, articleIdx: [0, 1, 2, 3], locationName: "Valencia, Spain" },
      { ...VALENCIA, title: "Valencia flooding", articleIdx: [4, 5, 6, 7], locationName: "Valencia Spain" },
    ]);
    decisions({ live: 0.95, same: 0.9 });
    await discoverGraph(fakeCtx().ctx);
    // Same fingerprint: merged into one candidate before judging.
    expect(boards.createBoard).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].evidence).toHaveLength(8);
  });

  it("fails the run when every scan query fails (no cassette)", async () => {
    await rm(dir, { recursive: true, force: true });
    await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
    await expect(discoverGraph(fakeCtx().ctx)).rejects.toThrow(/every scan query failed/);
    expect(ai.generateText).not.toHaveBeenCalled();
  });
});

describe("buildCandidates", () => {
  it("scores by outlets, recency and article count, best first", () => {
    const docs = [...valencia, ...minor] as FoundDoc[];
    const out = buildCandidates(
      [
        { title: "Street", crisisType: "flood", locationName: "Leeds", entities: [], articleIdx: [8, 9], ongoing: true },
        { ...VALENCIA, crisisType: "flood" } as never,
      ],
      docs,
      NOW,
    );
    expect(out.map((c) => c.title)).toEqual(["Valencia floods", "Street"]);
    // 8 outlets, newest 1h old, 8 articles: 0.5*1 + 0.3*exp(-1/12) + 0.2*8/15
    expect(out[0].score).toBeCloseTo(0.5 + 0.3 * Math.exp(-1 / 12) + 0.2 * (8 / 15), 5);
  });
});
