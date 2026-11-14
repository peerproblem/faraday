import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RENDERED_RETRIES, readSources, type ReadStats } from "./read";
import { scrapeMarkdown } from "../../contextdev";
import { oxylabsEnabled, oxyScrape } from "../../oxylabs";
import { saveSourceText } from "../../repo/boards";
import type { Source } from "../../spec";

vi.mock("../../contextdev", () => ({ scrapeMarkdown: vi.fn() }));
vi.mock("../../oxylabs", () => ({ oxylabsEnabled: vi.fn(), oxyScrape: vi.fn() }));
vi.mock("../../repo/boards", () => ({ saveSourceText: vi.fn() }));

const use = { llm: vi.fn(), context: vi.fn() };
const signal = new AbortController().signal;
const page = "x".repeat(400);
const src = (id: string, via: Source["via"] = null): Source => ({
  id, url: `https://example.org/${id}`, title: id, publisher: "example.org", kind: "web", publishedAt: null,
  fetchedAt: 0, snippet: null, relevance: 0.9, sourceType: "official", via,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(oxylabsEnabled).mockReturnValue(true);
  vi.mocked(scrapeMarkdown).mockResolvedValue(page);
  vi.mocked(oxyScrape).mockResolvedValue(page);
});

describe("readSources with Oxylabs", () => {
  it("reads Oxylabs-found sources through Oxylabs from the country, without Context.dev", async () => {
    let stats: ReadStats | undefined;
    const ids = await readSources("b", [src("s1", "oxylabs")], use, signal, new Set(), { country: "UA", onStats: (s) => (stats = s) });
    expect(ids).toEqual(["s1"]);
    expect(oxyScrape).toHaveBeenCalledWith("https://example.org/s1", { location: "UA", signal });
    expect(scrapeMarkdown).not.toHaveBeenCalled();
    expect(saveSourceText).toHaveBeenCalledWith("b", "s1", page);
    expect(stats).toEqual({ oxylabsRead: 1, rescued: 0, oxylabsCalls: 1 });
  });

  it("falls back to Context.dev when Oxylabs cannot read its own source", async () => {
    vi.mocked(oxyScrape).mockResolvedValueOnce(null);
    const ids = await readSources("b", [src("s1", "oxylabs")], use, signal, new Set(), { country: "UA" });
    expect(ids).toEqual(["s1"]);
    expect(scrapeMarkdown).toHaveBeenCalledTimes(1);
    expect(oxyScrape).toHaveBeenCalledTimes(1);
  });

  it("keeps Context.dev first for other sources and renders with Oxylabs only when it fails", async () => {
    vi.mocked(scrapeMarkdown).mockImplementation(async (url) => (url.endsWith("s2") ? "too short" : page));
    let stats: ReadStats | undefined;
    const ids = await readSources("b", [src("s1"), src("s2")], use, signal, new Set(), { country: "UA", onStats: (s) => (stats = s) });
    expect(ids.sort()).toEqual(["s1", "s2"]);
    expect(oxyScrape).toHaveBeenCalledTimes(1);
    expect(oxyScrape).toHaveBeenCalledWith("https://example.org/s2", { location: "UA", runJs: true, signal });
    expect(stats).toEqual({ oxylabsRead: 1, rescued: 1, oxylabsCalls: 1 });
  });

  it("caps rendered retries per call", async () => {
    vi.mocked(scrapeMarkdown).mockResolvedValue(null);
    const targets = ["s1", "s2", "s3", "s4"].map((id) => src(id));
    const ids = await readSources("b", targets, use, signal, new Set(), { country: "UA" });
    expect(oxyScrape).toHaveBeenCalledTimes(MAX_RENDERED_RETRIES);
    expect(ids).toHaveLength(MAX_RENDERED_RETRIES);
  });

  it("makes no Oxylabs call when disabled", async () => {
    vi.mocked(oxylabsEnabled).mockReturnValue(false);
    vi.mocked(scrapeMarkdown).mockResolvedValue(null);
    const ids = await readSources("b", [src("s1", "oxylabs"), src("s2")], use, signal);
    expect(ids).toEqual([]);
    expect(oxyScrape).not.toHaveBeenCalled();
    expect(scrapeMarkdown).toHaveBeenCalledTimes(2);
  });
});
