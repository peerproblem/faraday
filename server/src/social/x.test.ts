import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cassetteKey, CassetteMissError } from "../contextdev";
import { freshCursor, gatherX, searchX, xQuery } from "./x";

vi.mock("../repo/social", () => ({ reserveSocialReads: vi.fn(), getSocialCursor: vi.fn(async () => ({})) }));
const { reserveSocialReads, getSocialCursor } = await import("../repo/social");
const body = { data: [{ id: "1900000000000000001", author_id: "1", text: "Twelve roads are closed in Valencia.", created_at: "2026-11-14T00:00:00Z" }],
  includes: { users: [{ id: "1", username: "local_report" }] }, meta: { result_count: 1 } };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "faraday-x-"));
  vi.stubEnv("EVAL_CASSETTE_DIR", dir);
  vi.stubEnv("EVAL_REPLAY", "0");
  vi.stubEnv("EVAL_RECORD", "0");
  vi.stubEnv("X_API_BEARER_TOKEN", "test-secret-do-not-record");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  vi.mocked(reserveSocialReads).mockResolvedValue({ sinceId: "1900000000000000000" });
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); await rm(dir, { recursive: true, force: true }); });

describe("X recent search", () => {
  it("replays a poll using its DB cursor, with no credit reservation or network", async () => {
    vi.stubEnv("EVAL_RECORD", "1");
    const recorded = await gatherX("b", ["flood"], new AbortController().signal);
    vi.stubEnv("EVAL_REPLAY", "1");
    vi.stubEnv("X_API_BEARER_TOKEN", "");
    vi.mocked(getSocialCursor).mockResolvedValueOnce({ sinceId: "1900000000000000000" });
    expect(await gatherX("b", ["flood"], new AbortController().signal)).toEqual(recorded);
    expect(reserveSocialReads).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("maps full post text and authors with exact snowflake ids, one request at max_results 10", async () => {
    const docs = await searchX("Valencia -is:retweet", { sinceId: "1900000000000000000" });
    expect(docs[0]).toMatchObject({ kind: "social", snippet: body.data[0].text, url: "https://x.com/local_report/status/1900000000000000001" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = vi.mocked(fetch).mock.calls[0][0] as URL;
    expect(url.searchParams.get("max_results")).toBe("10");
    expect(url.searchParams.get("since_id")).toBe("1900000000000000000");
    expect(url.searchParams.get("expansions")).toBe("author_id");
  });
  it("records the raw response, then replays without token or network", async () => {
    vi.stubEnv("EVAL_RECORD", "1");
    const docs = await searchX("flood -is:retweet");
    const files = await readdir(dir);
    expect(files).toEqual([`${cassetteKey("x.search.recent", ["flood -is:retweet", null, 10])}.json`]);
    const tape = await readFile(path.join(dir, files[0]), "utf8");
    expect(tape).not.toContain("test-secret-do-not-record");
    expect(JSON.parse(tape).result).toEqual(body);
    vi.stubEnv("X_API_BEARER_TOKEN", "");
    vi.stubEnv("EVAL_REPLAY", "1");
    expect(await searchX("flood -is:retweet")).toEqual(docs);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(searchX("miss")).rejects.toBeInstanceOf(CassetteMissError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps long-form text and skips missing authors without fabricating usernames", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...body, data: [
      { ...body.data[0], note_tweet: { text: "Full long-form post" } },
      { ...body.data[0], id: "2", author_id: "unknown" },
    ] }));
    expect((await searchX("flood" )).map((d) => d.snippet)).toEqual(["Full long-form post"]);
  });
  it.each([401, 429, 503])("does not retry HTTP %s or expose response bodies", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("sensitive provider response", { status }));
    await expect(searchX("flood")).rejects.toThrow(`X recent search HTTP ${status}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts empty results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ meta: { result_count: 0 } }));
    expect(await searchX("flood")).toEqual([]);
  });
  it("combines local keywords/hashtags and preserves language filters while excluding retweets", () => {
    expect(xQuery(["Valencia #DANA lang:es", "inundaciones"])).toBe("((Valencia #DANA lang:es) OR (inundaciones)) -is:retweet");
    expect(xQuery(["flood -is:retweet"])).toBe("((flood)) -is:retweet");
    expect(xQuery([])).toBeNull();
    expect(xQuery(["x".repeat(513)])).toBeNull();
  });
  it("skips absent credentials, non-hot polls, and exhausted budgets", async () => {
    vi.stubEnv("X_API_BEARER_TOKEN", "");
    expect(await gatherX("b", ["flood"], new AbortController().signal)).toEqual([]);
    vi.stubEnv("X_API_BEARER_TOKEN", "fake");
    for (const tier of ["warm", "cold", "paused"] as const) expect(await gatherX("b", ["flood"], new AbortController().signal, { polling: true, tier })).toEqual([]);
    expect(reserveSocialReads).not.toHaveBeenCalled();
    vi.mocked(reserveSocialReads).mockResolvedValueOnce(null);
    expect(await gatherX("b", ["flood"], new AbortController().signal)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends a cursor inside the 7-day search window and drops an older one instead of failing every poll", async () => {
    const idAt = (ms: number) => String((BigInt(ms) - BigInt(1288834974657)) << BigInt(22));
    const now = Date.parse("2026-11-14T00:00:00Z");
    expect(freshCursor(idAt(now - 86_400_000), now)).toBe(idAt(now - 86_400_000));
    expect(freshCursor(idAt(now - 8 * 86_400_000), now)).toBeUndefined();
    expect(freshCursor(undefined, now)).toBeUndefined();
    const sinceIdOf = () => (vi.mocked(fetch).mock.calls.at(-1)![0] as URL).searchParams.get("since_id");
    const recent = idAt(Date.now() - 86_400_000);
    vi.mocked(reserveSocialReads).mockResolvedValueOnce({ sinceId: recent });
    await gatherX("b", ["flood"], new AbortController().signal);
    expect(sinceIdOf()).toBe(recent);
    vi.mocked(reserveSocialReads).mockResolvedValueOnce({ sinceId: idAt(Date.now() - 30 * 86_400_000) });
    await gatherX("b", ["flood"], new AbortController().signal);
    expect(sinceIdOf()).toBeNull();
  });
  it("uses the board cursor, reserves 10 and returns a cursor for acknowledgment after ingestion", async () => {
    const docs = await gatherX("b", ["flood"], new AbortController().signal, { polling: true, tier: "hot" });
    expect(reserveSocialReads).toHaveBeenCalledWith("b", expect.any(String), 10);
    expect(docs[0].socialCursor?.sinceId).toBe("1900000000000000001");
  });
});
