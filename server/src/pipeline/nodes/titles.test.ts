import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, Source } from "../../spec";

vi.mock("ai", () => ({ generateText: vi.fn(), Output: { object: (x: unknown) => x } }));
vi.mock("../../llm/models", () => ({ fastLlm: () => ({ model: "fast-model", modelId: "fast" }) }));
vi.mock("../../llm/decide", () => ({ decide: vi.fn() }));

const { generateText } = await import("ai");
const { decide } = await import("../../llm/decide");
const { englishTitles } = await import("./titles");
const { triage } = await import("./triage");

const use = { llm: vi.fn(), context: vi.fn() };
const signal = new AbortController().signal;
const src = (id: string, over: Partial<Source> = {}): Source => ({
  id,
  url: `https://example.ua/${id}`,
  title: "Графіки відключень",
  publisher: "example.ua",
  kind: "web",
  publishedAt: null,
  fetchedAt: 1,
  snippet: "Текст",
  relevance: null,
  sourceType: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("englishTitles", () => {
  it("returns English titles and drops ids, languages and titles it cannot trust", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        titles: [
          { id: "s1", lang: "UK", title: "  Outage   schedules in Kyiv " },
          { id: "s2", lang: "uk", title: "Графіки" },
          { id: "s9", lang: "uk", title: "Unknown id" },
          { id: "s1", lang: "uk", title: "Duplicate" },
        ],
      },
      usage: {},
    } as never);
    const out = await englishTitles([src("s1"), src("s2"), src("s3"), src("x1", { kind: "social", title: "@kyivnews" })], use, signal);
    expect(out).toEqual([
      { id: "s1", lang: "uk", titleEn: "Outage schedules in Kyiv" },
      { id: "s2", lang: "uk", titleEn: null },
      { id: "s3", lang: "und", titleEn: null },
      { id: "x1", lang: "und", titleEn: null },
    ]);
    // Social posts are not sent to the model.
    expect(JSON.parse(vi.mocked(generateText).mock.calls[0][0].prompt as string).map((s: { id: string }) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("never marks a source English because the model said so", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ output: { titles: [{ id: "s1", lang: "en", title: "Kyiv outages" }] }, usage: {} } as never);
    expect(await englishTitles([src("s1")], use, signal)).toEqual([{ id: "s1", lang: "und", titleEn: "Kyiv outages" }]);
  });

  it("skips the model when only social posts are given", async () => {
    expect(await englishTitles([src("x1", { kind: "social" })], use, signal)).toEqual([{ id: "x1", lang: "und", titleEn: null }]);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("triage language", () => {
  const plan = { title: "Kyiv outages", location: null, entities: [], monitor: { query: "", instructions: "" } } as unknown as Plan;
  it("reports P(English) and treats a missing answer as English", async () => {
    vi.mocked(decide)
      .mockResolvedValueOnce({ answers: { onTopic: { probability: 0.9 }, type: { choice: "official" }, hasFacts: { probability: 0.5 }, english: { probability: 0.1 } }, model: "m", tokensIn: 1 } as never)
      .mockResolvedValueOnce({ answers: { onTopic: { probability: 0.9 }, type: { choice: "news" }, hasFacts: { probability: 0.5 } }, model: "m", tokensIn: 1 } as never);
    const r = await triage(plan, [src("s1"), src("s2")], use, signal);
    expect(r.rows.map((x) => [x.id, x.english])).toEqual([["s1", 0.1], ["s2", 1]]);
  });
});
