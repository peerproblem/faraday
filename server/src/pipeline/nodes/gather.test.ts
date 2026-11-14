import { beforeEach, describe, expect, it, vi } from "vitest";
import { gather } from "./gather";
import { gatherX } from "../../social/x";
import { searchNews, searchWeb } from "../../contextdev";
import { oxylabsEnabled, oxySearch } from "../../oxylabs";

vi.mock("../../social/x", () => ({ gatherX: vi.fn() }));
vi.mock("../../contextdev", () => ({ searchNews: vi.fn(), searchWeb: vi.fn() }));
vi.mock("../../oxylabs", () => ({ oxylabsEnabled: vi.fn(), oxySearch: vi.fn() }));
const use = { llm: vi.fn(), context: vi.fn() };
const signal = new AbortController().signal;
const q = { newsQueries: ["news"], webQueries: ["official"], socialQueries: ["Valencia #DANA lang:es"], lookbackDays: 7 };
const doc = { url: "https://x.com/local/status/1", kind: "social" as const, title: "@local", publisher: "@local", snippet: "Local report", publishedAt: null };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(searchNews).mockResolvedValue([]); vi.mocked(searchWeb).mockResolvedValue([]); vi.mocked(gatherX).mockResolvedValue([doc]); vi.mocked(oxylabsEnabled).mockReturnValue(true); vi.mocked(oxySearch).mockResolvedValue([]); });
describe("gather social jobs", () => {
  it("collects X alongside news/web, without counting it as a Context.dev call", async () => {
    const result = await gather(q, use, signal, { boardId: "b" });
    expect(result.docs).toEqual([doc]);
    expect(result.calls).toBe(2);
    expect(use.context).toHaveBeenCalledWith(2);
    expect(gatherX).toHaveBeenCalledWith("b", q.socialQueries, signal, { boardId: "b" });
  });
  it("preserves news/web results on X failure and does not leak upstream error details", async () => {
    vi.mocked(gatherX).mockRejectedValueOnce(new Error("sensitive transport detail"));
    vi.mocked(searchNews).mockResolvedValueOnce([{ ...doc, url: "https://news.example/a", kind: "news" }]);
    const result = await gather(q, use, signal, { boardId: "b" });
    expect(result.docs).toHaveLength(1);
    expect(result.docs[0].kind).toBe("news");
    expect(result.failures).toEqual(["X social search failed (credentials, budget store or API unavailable)"]);
  });
  it("old plans and callers without board context make no social call", async () => {
    await gather({ ...q, socialQueries: undefined }, use, signal, { boardId: "b" });
    await gather(q, use, signal);
    expect(gatherX).not.toHaveBeenCalled();
  });
});

describe("gather Oxylabs local search", () => {
  const web = (url: string) => ({ url, kind: "web" as const, title: "t", publisher: "p", snippet: "s", publishedAt: null });
  const local = (url: string) => ({ ...web(url), via: "oxylabs" as const, geo: "UA" });
  const lq = { ...q, socialQueries: undefined, localQueries: ["Київ відключення", "графік світла"] };

  it("makes no Oxylabs call without a country or when disabled", async () => {
    const a = await gather(lq, use, signal, { boardId: "b" });
    expect(oxySearch).not.toHaveBeenCalled();
    expect(a).toMatchObject({ localFound: 0, localAdded: 0, oxylabsCalls: 0 });
    vi.mocked(oxylabsEnabled).mockReturnValue(false);
    await gather(lq, use, signal, { boardId: "b", country: "UA" });
    expect(oxySearch).not.toHaveBeenCalled();
  });

  it("runs local queries plus the first web query from the country, not counted as Context.dev calls", async () => {
    const r = await gather(lq, use, signal, { boardId: "b", country: "UA" });
    expect(vi.mocked(oxySearch).mock.calls.map((c) => c[0])).toEqual(["Київ відключення", "графік світла", "official"]);
    expect(vi.mocked(oxySearch).mock.calls[0][1]).toMatchObject({ location: "UA", maxResults: 8 });
    expect(r.oxylabsCalls).toBe(3);
    expect(r.calls).toBe(2);
    expect(use.context).toHaveBeenCalledWith(2);
  });

  it("orders local docs after Context.dev and counts only new URLs as added", async () => {
    vi.mocked(searchWeb).mockResolvedValueOnce([web("https://gov.ua/a")]);
    vi.mocked(oxySearch).mockResolvedValueOnce([local("https://gov.ua/a"), local("https://kyiv.ua/b")]);
    const r = await gather(lq, use, signal, { boardId: "b", country: "UA" });
    expect(r.docs.map((d) => d.url)).toEqual(["https://gov.ua/a", "https://kyiv.ua/b"]);
    expect(r.docs[0].via).toBeUndefined();
    expect(r.docs[1].via).toBe("oxylabs");
    expect(r).toMatchObject({ localFound: 2, localAdded: 1 });
  });

  it("reports a failed local search without losing other results", async () => {
    vi.mocked(searchNews).mockResolvedValueOnce([web("https://news.example/a")]);
    vi.mocked(oxySearch).mockRejectedValue(new Error("HTTP 429"));
    const r = await gather(lq, use, signal, { boardId: "b", country: "UA" });
    expect(r.docs).toHaveLength(1);
    expect(r.failures[0]).toBe("Local search from UA failed: HTTP 429");
    expect(r.localAdded).toBe(0);
  });
});
