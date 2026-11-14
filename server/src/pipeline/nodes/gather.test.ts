import { beforeEach, describe, expect, it, vi } from "vitest";
import { gather } from "./gather";
import { gatherX } from "../../social/x";
import { searchNews, searchWeb } from "../../contextdev";

vi.mock("../../social/x", () => ({ gatherX: vi.fn() }));
vi.mock("../../contextdev", () => ({ searchNews: vi.fn(), searchWeb: vi.fn() }));
const use = { llm: vi.fn(), context: vi.fn() };
const signal = new AbortController().signal;
const q = { newsQueries: ["news"], webQueries: ["official"], socialQueries: ["Valencia #DANA lang:es"], lookbackDays: 7 };
const doc = { url: "https://x.com/local/status/1", kind: "social" as const, title: "@local", publisher: "@local", snippet: "Local report", publishedAt: null };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(searchNews).mockResolvedValue([]); vi.mocked(searchWeb).mockResolvedValue([]); vi.mocked(gatherX).mockResolvedValue([doc]); });
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
