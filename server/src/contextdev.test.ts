import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { __setContextClientForTest, CassetteMissError, scrapeMarkdown, searchNews, searchWeb } from "./contextdev";

const webResult = {
  results: [{ url: "https://www.gov.example/alert", title: "Alert", description: "desc", highlights: { code: "SUCCESS", highlights: ["Evacuate now"] } }],
};

function fakeClient() {
  return {
    web: {
      search: vi.fn(async () => webResult),
      scrape: vi.fn(async () => ({ markdown: { success: true, data: "# Page\nBody", requested: true } })),
    },
    news: { search: vi.fn(async () => ({ data: [] })) },
  };
}

describe("contextdev cassettes", () => {
  let dir: string;
  const saved = { ...process.env };
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "faraday-cassettes-"));
  });
  afterEach(() => {
    process.env.EVAL_RECORD = saved.EVAL_RECORD;
    process.env.EVAL_REPLAY = saved.EVAL_REPLAY;
    process.env.EVAL_CASSETTE_DIR = saved.EVAL_CASSETTE_DIR;
    __setContextClientForTest(undefined);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps web results without cassettes", async () => {
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    __setContextClientForTest(fakeClient());
    const docs = await searchWeb("q", "last_week", 3);
    expect(docs).toEqual([{ url: "https://www.gov.example/alert", title: "Alert", publisher: "gov.example", publishedAt: null, snippet: "Evacuate now", kind: "web", via: "contextdev" }]);
  });

  it("saves each news page before requesting the next cursor", async () => {
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    const save = vi.fn();
    const search = vi.fn()
      .mockResolvedValueOnce({ data: [{ url: "https://a.example/" }], has_more: true, next_cursor: "next" })
      .mockImplementationOnce(async (input: { cursor?: string }) => {
        expect(input.cursor).toBe("next");
        expect(save).toHaveBeenCalledWith([expect.objectContaining({ url: "https://a.example/" })], 0);
        return { data: [{ url: "https://b.example/" }], has_more: false };
      });
    __setContextClientForTest({ news: { search } });
    const results = await searchNews("storm", 0, 1, undefined, save);
    expect(results.map((doc) => doc.url)).toEqual(["https://a.example/"]);
    expect(save).toHaveBeenNthCalledWith(2, [expect.objectContaining({ url: "https://b.example/" })], 1);
  });

  it("records, then replays without the network", async () => {
    process.env.EVAL_CASSETTE_DIR = dir;
    process.env.EVAL_RECORD = "1";
    delete process.env.EVAL_REPLAY;
    const live = fakeClient();
    __setContextClientForTest(live);
    const recorded = await searchWeb("flood shelters", "last_week", 4);
    const md = await scrapeMarkdown("https://gov.example/page");
    expect(md).toBe("# Page\nBody");
    expect((await readdir(dir)).length).toBe(2);

    delete process.env.EVAL_RECORD;
    process.env.EVAL_REPLAY = "1";
    const offline = fakeClient();
    __setContextClientForTest(offline);
    expect(await searchWeb("flood shelters", "last_week", 4)).toEqual(recorded);
    expect(await scrapeMarkdown("https://gov.example/page")).toBe("# Page\nBody");
    expect(offline.web.search).not.toHaveBeenCalled();
    expect(offline.web.scrape).not.toHaveBeenCalled();
  });

  it("throws on a replay miss", async () => {
    process.env.EVAL_CASSETTE_DIR = dir;
    process.env.EVAL_REPLAY = "1";
    __setContextClientForTest(fakeClient());
    await expect(searchWeb("never recorded", "last_week", 4)).rejects.toBeInstanceOf(CassetteMissError);
  });

  it("caps the cache age of scraped pages and of the pages behind search highlights", async () => {
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    const c = fakeClient();
    __setContextClientForTest(c);
    await searchWeb("q", "last_week", 3);
    await scrapeMarkdown("https://gov.example/a");
    await scrapeMarkdown("https://gov.example/b", undefined, { maxAgeMs: 0 });
    const search = (c.web.search.mock.calls as unknown as [Record<string, any>][])[0][0];
    expect(search.markdownOptions).toEqual({ maxAgeMs: 30 * 60_000 });
    expect(search.markdownOptions.enabled).toBeUndefined();
    const scrapes = (c.web.scrape.mock.calls as unknown as [Record<string, any>][]).map((x) => x[0].maxAgeMs);
    expect(scrapes).toEqual([10 * 60_000, 0]);
  });

  it("returns null when a scrape fails", async () => {
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    const c = fakeClient();
    c.web.scrape.mockRejectedValueOnce(new Error("boom"));
    __setContextClientForTest(c);
    expect(await scrapeMarkdown("https://x.example")).toBeNull();
  });
});
