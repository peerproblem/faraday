import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outlineAge, oxyRetry, oxyScrape, oxySearch, oxylabsEnabled } from "./oxylabs";

const KEY = "test-secret-key-abc123";
const saved = { ...process.env };

type Call = { url: string; body: Record<string, unknown>; auth: string | null };

function stubFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      auth: new Headers(init?.headers).get("Authorization"),
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const json = (status: number, body: unknown) =>
  () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const searchBody = {
  state: "done",
  results: [
    { title: "Outage schedule", outline: ["2 days ago - Kyiv outages follow a schedule.", "More text"], url: "https://www.yasno.com.ua/schedule", metadata: { position: 1 } },
    { title: "No age", outline: ["Static page"], url: "https://kyiv.gov.ua/" },
    { title: "Bad", outline: [], url: "javascript:alert(1)" },
  ],
};

describe("oxylabs", () => {
  beforeEach(() => {
    process.env.OXYLABS_WEB_API_KEY = KEY;
    delete process.env.EVAL_RECORD;
    delete process.env.EVAL_REPLAY;
    oxyRetry.baseMs = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.OXYLABS_WEB_API_KEY = saved.OXYLABS_WEB_API_KEY;
    process.env.EVAL_RECORD = saved.EVAL_RECORD;
    process.env.EVAL_REPLAY = saved.EVAL_REPLAY;
    if (saved.OXYLABS_WEB_API_KEY === undefined) delete process.env.OXYLABS_WEB_API_KEY;
    if (saved.EVAL_RECORD === undefined) delete process.env.EVAL_RECORD;
    if (saved.EVAL_REPLAY === undefined) delete process.env.EVAL_REPLAY;
  });

  it("searches from a country and maps results to sources", async () => {
    const calls = stubFetch([json(200, searchBody)]);
    const docs = await oxySearch("графік відключень Київ", { location: "UA", maxResults: 50 });
    expect(calls[0].url).toBe("https://webapi.oxylabs.io/v1/search");
    expect(calls[0].body).toEqual({ query: "графік відключень Київ", max_results: 20, location: "UA" });
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      url: "https://www.yasno.com.ua/schedule",
      title: "Outage schedule",
      publisher: "yasno.com.ua",
      snippet: "2 days ago - Kyiv outages follow a schedule.\nMore text",
      kind: "web",
      via: "oxylabs",
      geo: "UA",
    });
    expect(docs[0].publishedAt).not.toBeNull();
    expect(docs[1].publishedAt).toBeNull();
  });

  it("drops an invalid location and defaults max_results", async () => {
    const calls = stubFetch([json(200, { results: [] }), json(200, { results: [] })]);
    await oxySearch("q", { location: "ukraine" });
    await oxySearch("q", { location: "ua" });
    expect(calls[0].body).toEqual({ query: "q", max_results: 8 });
    expect(calls[1].body).toEqual({ query: "q", max_results: 8 });
  });

  it("parses leading relative ages only", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(outlineAge("3 hours ago - text", now)).toBe("2026-11-14T09:00:00.000Z");
    expect(outlineAge("2 days ago - text", now)).toBe("2026-11-12T12:00:00.000Z");
    expect(outlineAge("4 weeks ago - text", now)).toBe("2026-10-17T12:00:00.000Z");
    expect(outlineAge("1 month ago", now)).toBe("2026-10-15T12:00:00.000Z");
    expect(outlineAge("a day ago", now)).toBe("2026-11-13T12:00:00.000Z");
    expect(outlineAge("Updated 2 days ago", now)).toBeNull();
    expect(outlineAge(null, now)).toBeNull();
  });

  it("retries once on 503 then succeeds", async () => {
    const calls = stubFetch([json(503, { title: "SERVICE_UNAVAILABLE" }), json(200, searchBody)]);
    const docs = await oxySearch("q");
    expect(calls).toHaveLength(2);
    expect(docs).toHaveLength(2);
  });

  it("does not retry on 400 and reports the problem title without the key", async () => {
    const calls = stubFetch([json(400, { status: 400, title: "VALIDATION_ERROR", detail: `bad ${KEY}` })]);
    const err = await oxySearch("q").catch((e: Error) => e);
    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Oxylabs /search HTTP 400 VALIDATION_ERROR");
    expect((err as Error).message).not.toContain(KEY);
  });

  it("gives a generic message on transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`connect failed Authorization: Bearer ${KEY}`);
    }));
    const err = (await oxySearch("q").catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Oxylabs /search transport failed");
    expect(err.message).not.toContain(KEY);
  });

  it("scrapes Markdown with location and rendering", async () => {
    const calls = stubFetch([json(200, { status: 200, results: [{ markdown: "  # Page\nBody  " }] })]);
    expect(await oxyScrape("https://kyiv.gov.ua/", { location: "UA", runJs: true })).toBe("# Page\nBody");
    expect(calls[0].url).toBe("https://webapi.oxylabs.io/v1/scrape");
    expect(calls[0].body).toEqual({ url: "https://kyiv.gov.ua/", output: ["markdown"], location: "UA", run_js: true });
  });

  it("returns null when a scrape fails or is empty", async () => {
    stubFetch([json(500, { title: "INTERNAL_SERVER_ERROR" }), json(500, {}), json(200, { results: [{ markdown: "   " }] })]);
    expect(await oxyScrape("https://a.example/")).toBeNull();
    expect(await oxyScrape("https://b.example/")).toBeNull();
  });

  it("rethrows when the caller aborts a scrape", async () => {
    const ac = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      ac.abort();
      throw new Error("aborted");
    }));
    await expect(oxyScrape("https://a.example/", { signal: ac.signal })).rejects.toThrow();
  });

  it("handles a missing key", async () => {
    delete process.env.OXYLABS_WEB_API_KEY;
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    expect(oxylabsEnabled()).toBe(false);
    await expect(oxySearch("q")).rejects.toThrow("OXYLABS_WEB_API_KEY is not set");
    expect(await oxyScrape("https://a.example/")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    process.env.EVAL_REPLAY = "1";
    expect(oxylabsEnabled()).toBe(true);
  });
});
