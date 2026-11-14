import { describe, expect, it, vi } from "vitest";
import type { Fact, Source } from "../spec";
import { evidenceOf } from "./evidence";
import { keepsFigures, pickQuotes, translateQuotes } from "./nodes/translate";

vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: vi.fn() }));
vi.mock("../llm/models", () => ({ fastLlm: () => ({ modelId: "test-model" }), GROUNDING_RULES: "" }));
const { generateText } = await import("ai");

const src = (patch: Partial<Source>): Source => ({
  id: "s1", url: "https://example.org/a", title: "A", publisher: null, kind: "news", publishedAt: null, fetchedAt: 0, snippet: null, relevance: 0.9, sourceType: "news", lang: "en", ...patch,
});
const fact = (patch: Partial<Fact>): Fact => ({
  id: 1, boardId: "b", kind: "event", key: "k", payload: { title: "T", detail: "", importance: "medium" }, valueNum: null, asOf: null,
  sourceIds: ["s1"], quote: "At least 115 people were arrested.", verified: true, status: "active", supersededBy: null, runId: null, createdAt: 0, ...patch,
});
const map = (...s: Source[]) => new Map(s.map((x) => [x.id, x]));

describe("the sentence behind a figure", () => {
  it("is the source's own words when the source is in English", () => {
    expect(evidenceOf(fact({}), map(src({})))).toEqual({ source: "s1", quote: "At least 115 people were arrested." });
  });

  it("belongs to the first source, the one it was copied from", () => {
    expect(evidenceOf(fact({ sourceIds: ["s2", "s1"] }), map(src({}), src({ id: "s2" })))?.source).toBe("s2");
  });

  it("is the translation, with the original beside it, for a source in another language", () => {
    const es = src({ lang: "es" });
    const f = fact({ quote: "Al menos 115 personas fueron detenidas.", quoteEn: "At least 115 people were arrested." });
    expect(evidenceOf(f, map(es))).toEqual({ source: "s1", quote: "At least 115 people were arrested.", original: "Al menos 115 personas fueron detenidas." });
  });

  it("is withheld until a translation exists, so the original alone never reaches a client", () => {
    expect(evidenceOf(fact({ quote: "Al menos 115 personas fueron detenidas." }), map(src({ lang: "es" })))).toBeUndefined();
    // Triage said English, the letters say otherwise.
    expect(evidenceOf(fact({ quote: "Затримано 115 осіб." }), map(src({})))).toBeUndefined();
    expect(evidenceOf(fact({ quote: "x", quoteEn: "Затримано" }), map(src({ lang: "uk" })))).toBeUndefined();
  });

  it("needs a quote and a known source", () => {
    expect(evidenceOf(fact({ quote: null }), map(src({})))).toBeUndefined();
    expect(evidenceOf(fact({ sourceIds: ["s9"] }), map(src({})))).toBeUndefined();
  });
});

describe("quote translation", () => {
  it("picks untranslated quotes from non-English sources, posts first, then the newest", () => {
    const sources = [src({}), src({ id: "s2", lang: "es" }), src({ id: "x1", lang: "und", kind: "social", sourceType: "social" })];
    const facts = [
      fact({ id: 1 }),
      fact({ id: 2, sourceIds: ["s2"], quote: "Uno." }),
      fact({ id: 3, sourceIds: ["s2"], quote: "Dos.", quoteEn: "Two." }),
      fact({ id: 4, sourceIds: ["s2", "s1"], quote: "Tres." }),
      fact({ id: 5, sourceIds: ["x1"], quote: "Cuatro." }),
      fact({ id: 6, sourceIds: ["s2"], quote: "Cinco.", status: "superseded" }),
    ];
    expect(pickQuotes(facts, sources)).toEqual([
      { id: 5, quote: "Cuatro.", lang: null },
      { id: 4, quote: "Tres.", lang: "es" },
      { id: 2, quote: "Uno.", lang: "es" },
    ]);
    expect(pickQuotes(facts, sources, 1).map((q) => q.id)).toEqual([5]);
  });

  it("lets a translation keep or spell out a figure, never add one", () => {
    expect(keepsFigures("Más de 3.000 personas el 11 de noviembre", "More than 3,000 people on November 11")).toBe(true);
    expect(keepsFigures("Tres millones de personas", "Three million people")).toBe(true);
    expect(keepsFigures("Hubo 70 detenidos", "There were 115 arrests")).toBe(false);
    expect(keepsFigures("Hubo detenidos", "There were 70 arrests")).toBe(false);
  });

  it("drops translations for unknown ids, repeats, other scripts and invented figures", async () => {
    const use = { llm: vi.fn(), context: vi.fn() };
    vi.mocked(generateText).mockResolvedValueOnce({
      usage: {},
      output: {
        translations: [
          { id: 1, english: "  There were  70 arrests. " },
          { id: 1, english: "Again." },
          { id: 2, english: "There were 115 arrests." },
          { id: 3, english: "Затримано" },
          { id: 9, english: "Nobody asked." },
        ],
      },
    } as never);
    const out = await translateQuotes(
      [{ id: 1, quote: "Hubo 70 detenidos.", lang: "es" }, { id: 2, quote: "Hubo 70 detenidos.", lang: "es" }, { id: 3, quote: "Hubo detenidos.", lang: null }],
      use,
      new AbortController().signal,
    );
    expect(out).toEqual([{ id: 1, quoteEn: "There were 70 arrests." }]);
    expect(use.llm).toHaveBeenCalledOnce();
  });
});
