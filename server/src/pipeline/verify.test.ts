import { describe, expect, it } from "vitest";
import type { ExtractedFact, Source } from "../spec";
import { extractNumbers, interpretDigits, normalizeText, parseNumber, quoteInText, verifyFacts } from "./verify";

describe("parseNumber", () => {
  const cases: [string, number | null][] = [
    ["12,400", 12400],
    ["12,400 people", 12400],
    ["1,234,567", 1234567],
    ["1.234.567", 1234567],
    ["1.234,5", 1234.5],
    ["1,234.5", 1234.5],
    ["2.500 evacuados", 2500],
    ["3,5 metros", 3.5],
    ["0.125", 0.125],
    ["0,125", 0.125],
    ["1.2 million", 1_200_000],
    ["1.2 millones", 1_200_000],
    ["1,5 millones de personas", 1_500_000],
    ["2 billion", 2e9],
    ["3.4bn", 3.4e9],
    ["10 mil personas", 10_000],
    ["45 thousand", 45_000],
    ["5k", 5000],
    ["5 km", 5],
    ["5 m of water", 5],
    ["3 of 7", 3],
    ["about 40", 40],
    ["10-12 dead", 10],
    ["10–12 dead", 10],
    ["45%", 45],
    ["12 400 personnes", 12400],
    ["12 400", 12400],
    ["1만", 10_000],
    ["3만 5천명", 35_000],
    ["1억 2천만", 120_000_000],
    ["2억", 200_000_000],
    ["사망자 12명", 12],
    ["three dead", 3],
    ["a dozen homes", 12],
    ["two million", 2_000_000],
    ["COVID-19 cases", 19],
    ["-3 degrees", -3],
    ["magnitude M7.2", 7.2],
    ["no figures yet", null],
    ["", null],
  ];
  for (const [text, want] of cases) {
    it(`${JSON.stringify(text)} -> ${want}`, () => expect(parseNumber(text)).toBe(want));
  }
});

describe("interpretDigits", () => {
  it("keeps decimals with one or two digits", () => {
    expect(interpretDigits("1.5")).toBe(1.5);
    expect(interpretDigits("1,25")).toBe(1.25);
  });
  it("treats repeated separators as grouping", () => {
    expect(interpretDigits("1,000,000")).toBe(1_000_000);
  });
});

describe("extractNumbers", () => {
  it("returns scaled and raw values", () => {
    const n = extractNumbers("At least 1.2 million people and 340 homes");
    expect(n).toContain(1_200_000);
    expect(n).toContain(1.2);
    expect(n).toContain(340);
  });
  it("finds every number in a dated quote", () => {
    expect(extractNumbers("On October 30, 2026, 12 people died")).toEqual(expect.arrayContaining([30, 2026, 12]));
  });
});

describe("quoteInText", () => {
  const corpus = "## Update\n\nAt least **12 people** have died, the [regional government](https://gva.es) said on Tuesday.\n\nRain continues.";
  it("ignores markdown and whitespace", () => {
    expect(quoteInText("At least 12 people have died, the regional government said", corpus)).toBe(true);
  });
  it("is case-insensitive and strips quote marks", () => {
    expect(quoteInText("“AT LEAST 12 PEOPLE HAVE DIED”", corpus)).toBe(true);
  });
  it("matches ellipsis segments in order", () => {
    expect(quoteInText("At least 12 people … said on Tuesday", corpus)).toBe(true);
    expect(quoteInText("said on Tuesday ... At least 12 people", corpus)).toBe(false);
  });
  it("rejects text that is not there", () => {
    expect(quoteInText("At least 15 people have died", corpus)).toBe(false);
  });
  it("normalises typographic quotes and dashes", () => {
    expect(normalizeText("“Don’t go” — now")).toBe('"don\'t go" - now');
  });
});

function src(id: string, over: Partial<Source> = {}): Source {
  return {
    id,
    url: `https://example.org/${id}`,
    title: null,
    publisher: null,
    kind: "news",
    publishedAt: null,
    fetchedAt: 0,
    snippet: null,
    relevance: 0.9,
    sourceType: "news",
    ...over,
  };
}

const metric = (over: Partial<ExtractedFact<"metric">> = {}, payload: Partial<ExtractedFact<"metric">["payload"]> = {}): ExtractedFact => ({
  kind: "metric",
  key: "deaths",
  sourceId: "s1",
  quote: "At least 12 people have died",
  asOf: "2026-10-30T10:00:00Z",
  payload: { valueText: "12", valueNum: 12, unit: "people", scope: null, ...payload },
  ...over,
});

describe("verifyFacts", () => {
  it("applies the identical quote and numeric checks to social post bodies", () => {
    const social = src("sx", { kind: "social", sourceType: "social", snippet: "At least 12 people have died in Valencia." });
    const ok = verifyFacts({ facts: [metric({ sourceId: "sx" })], sources: [social], texts: new Map() });
    expect(ok.accepted[0].sourceType).toBe("social");
    const bad = verifyFacts({ facts: [metric({ sourceId: "sx", quote: "At least 40 people have died" }, { valueText: "40", valueNum: 40 })], sources: [social], texts: new Map() });
    expect(bad.rejected[0].reason).toBe("quote not found in source");
  });
  const sources = [
    src("s1", { snippet: "At least 12 people have died in Valencia. Some 1.2 million people are without power." }),
    src("s2", { url: "https://www.gva.es/en/alerts", sourceType: "official", relevance: 0.95, title: "Red alert for rain" }),
    src("s3", { snippet: "Shelters are open. Call 112 or visit https://cruzroja.es/valencia for help." }),
  ];
  const texts = new Map([["s2", "# Red alert\n\nThe red alert for heavy rain stays in force until Thursday. Evacuate low-lying areas now."]]);

  it("accepts a metric whose number is in the quote", () => {
    const r = verifyFacts({ facts: [metric()], sources, texts });
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0].valueNum).toBe(12);
    expect(r.accepted[0].sourceType).toBe("news");
    expect(r.accepted[0].relevance).toBe(0.9);
  });

  it("verifies locally formatted official counts and drops unsupported chart slices", () => {
    const through = "2026-11-11T23:59:00Z";
    const quote = "The authority recorded 1.857 incidents: 1.137 floods and 720 other incidents.";
    const tally: ExtractedFact<"row"> = {
      kind: "row", key: "incident-totals:mainland-portugal", sourceId: "s2", asOf: through, quote,
      payload: { table: "incident-totals", cells: {
        region: "Mainland Portugal", "total-incidents": "1857", "reporting-window-end": through,
        breakdown: '[{"label":"Floods","value":1137},{"label":"Other","value":720}]',
      } },
    };
    const unsupported = { ...tally, payload: { ...tally.payload, cells: {
      ...tally.payload.cells, breakdown: '[{"label":"Floods","value":1138},{"label":"Other","value":719}]',
    } } };
    const r = verifyFacts({ facts: [tally, unsupported, { ...tally, sourceId: "s1" }], sources, texts: new Map([["s1", quote], ["s2", quote]]) });
    expect(r.accepted.map(({ payload }) => (payload as typeof tally.payload).cells.breakdown)).toEqual([
      tally.payload.cells.breakdown, undefined,
    ]);
    expect(r.rejected).toHaveLength(1);
  });

  it("rejects an unknown source", () => {
    const r = verifyFacts({ facts: [metric({ sourceId: "s9" })], sources, texts });
    expect(r.rejected[0].reason).toMatch(/unknown source/);
  });

  it("rejects a quote that is not in the source", () => {
    const r = verifyFacts({ facts: [metric({ quote: "At least 40 people have died" }, { valueText: "40", valueNum: 40 })], sources, texts });
    expect(r.rejected[0].reason).toBe("quote not found in source");
  });

  it("rejects a metric whose value is not in the quote", () => {
    const r = verifyFacts({ facts: [metric({}, { valueText: "15", valueNum: 15 })], sources, texts });
    expect(r.rejected[0].reason).toBe("metric value not in quote");
  });

  it("rejects a metric with no number", () => {
    const r = verifyFacts({ facts: [metric({}, { valueText: "many", valueNum: null })], sources, texts });
    expect(r.rejected[0].reason).toBe("metric has no number");
  });

  it("prefers the value written in valueText and fixes the model's valueNum", () => {
    const f = metric(
      { key: "without-power", quote: "Some 1.2 million people are without power" },
      { valueText: "1.2 million", valueNum: 1.2 },
    );
    const r = verifyFacts({ facts: [f], sources, texts });
    expect(r.accepted[0].valueNum).toBe(1_200_000);
    expect((r.accepted[0].payload as { valueNum: number }).valueNum).toBe(1_200_000);
  });

  it("checks quotes against the full text of read sources", () => {
    const f: ExtractedFact = {
      kind: "advisory",
      key: "red-alert",
      sourceId: "s2",
      quote: "The red alert for heavy rain stays in force until Thursday.",
      asOf: null,
      payload: { issuer: "GVA", title: "Red alert", text: "Heavy rain", level: "warning", url: "https://www.gva.es/en/alerts", active: true },
    };
    const r = verifyFacts({ facts: [f], sources, texts });
    expect(r.accepted).toHaveLength(1);
    expect((r.accepted[0].payload as { url: string }).url).toBe("https://www.gva.es/en/alerts");
  });

  it("drops an advisory url from an unknown host but keeps the advisory", () => {
    const f: ExtractedFact = {
      kind: "advisory",
      key: "red-alert",
      sourceId: "s2",
      quote: "Evacuate low-lying areas now",
      asOf: null,
      payload: { issuer: "GVA", title: "Evacuate", text: "", level: "warning", url: "https://phishy.example.com/x", active: true },
    };
    const r = verifyFacts({ facts: [f], sources, texts });
    expect((r.accepted[0].payload as { url: string | null }).url).toBeNull();
  });

  it("accepts a resource whose host appears in source text, rejects an unknown host", () => {
    const ok: ExtractedFact = {
      kind: "resource",
      key: "red-cross",
      sourceId: "s3",
      quote: "visit https://cruzroja.es/valencia for help",
      asOf: null,
      payload: { label: "Red Cross", url: "https://cruzroja.es/valencia", resourceKind: "shelter", note: "" },
    };
    const bad: ExtractedFact = { ...ok, key: "x", payload: { ...(ok.payload as object), url: "https://donate-now.example.net" } as ExtractedFact["payload"] };
    const r = verifyFacts({ facts: [ok, bad], sources, texts });
    expect(r.accepted.map((f) => f.key)).toEqual(["red-cross"]);
    expect(r.rejected[0].reason).toMatch(/host/);
  });

  it("rejects short quotes and malformed payloads", () => {
    const r = verifyFacts({
      facts: [
        metric({ quote: "12" }),
        { kind: "status", key: "x:y", sourceId: "s1", quote: "At least 12 people have died", asOf: null, payload: { group: "x", name: "y", state: "broken", note: "" } } as unknown as ExtractedFact,
        { kind: "event", key: "e", sourceId: "s1", quote: "At least 12 people have died", asOf: null, payload: { title: "", detail: "", importance: "high" } },
      ],
      sources,
      texts,
    });
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(["quote too short", "status state invalid", "payload needs title"]);
  });
});
