import { describe, expect, it } from "vitest";
import type { BoardData, BoardSpecV2, TableData } from "@/lib/spec";
import { assetsIn, indexOfLabel, tickerOf } from "@/lib/market-symbols";
import { filled, inScale, metricSeries, parseNumber, placedWidgets, rankEntries, ranking, reaction, sessionAxis, tableLanes, unitGroups } from "./finance-data";

const row = (id: string, cells: Record<string, string>, asOf: string | null = null) => ({ id, cells, sources: [`s${id}`], asOf });
const companies: TableData = {
  columns: [
    { key: "company", label: "Company", kind: "text" },
    { key: "ticker", label: "Ticker", kind: "text" },
    { key: "drop", label: "Drop (%)", kind: "number" },
    { key: "cap", label: "Market Cap Lost", kind: "text" },
  ],
  rows: [
    row("1", { company: "Nvidia", ticker: "", drop: "", cap: "$430b" }),
    row("2", { company: "Micron", ticker: "MU", drop: "-16.63%", cap: "Not specified" }, "2026-11-06T00:00:00Z"),
    row("3", { company: "Advanced Micro Devices", ticker: "AMD", drop: "-15.5%", cap: "N/A" }, "2026-11-06T00:00:00Z"),
    row("4", { company: "Micron Technology", ticker: "", drop: "-14.77%", cap: "" }, "2026-11-05T00:00:00Z"),
    row("5", { company: "AMD", ticker: "", drop: "17%", cap: "" }, "2026-11-05T00:00:00Z"),
    row("6", { company: "Tesla Inc.", ticker: "TSLA", drop: "-10.2%", cap: "N/A" }, "2026-11-06T00:00:00Z"),
  ],
};
const responses: TableData = {
  columns: [
    { key: "authority", label: "Authority", kind: "text" },
    { key: "action", label: "Action", kind: "text" },
    { key: "time", label: "Time", kind: "time" },
    { key: "status", label: "Status", kind: "status" },
  ],
  rows: [row("9", { authority: "Federal Reserve", action: "Warned of overvaluation", time: "2026-11-15T01:17:00Z", status: "Warning issued" })],
};

const spec: BoardSpecV2 = {
  version: 2,
  widgets: [
    { id: "w1", type: "stat-grid", title: "Figures", span: "full", bind: null, metrics: [] },
    { id: "w2", type: "trend", title: "Nasdaq", span: "half", bind: "nasdaq", metrics: [] },
    { id: "w3", type: "table", title: "Companies", span: "full", bind: "companies", metrics: [] },
    { id: "w4", type: "table", title: "Responses", span: "full", bind: "responses", metrics: [] },
    { id: "w5", type: "link-list", title: "Links", span: "half", bind: null, metrics: [] },
  ],
};
const stat = (key: string, label: string, unit: string, history: { t: string; v: number }[]) => ({
  key, label, unit, valueText: String(history.at(-1)?.v ?? ""), valueNum: history.at(-1)?.v ?? null, delta: null, deltaNum: null,
  tone: "info" as const, conflict: null, history, sources: [], asOf: null,
});
const data = {
  header: {} as BoardData["header"],
  hidden: ["w5"],
  generatedAt: 0,
  widgets: {
    w1: { items: [
      stat("nasdaq", "Nasdaq", "%", [{ t: "2026-11-05T00:00:00Z", v: -5 }, { t: "2026-11-06T00:00:00Z", v: 1 }]),
      stat("dow", "Dow", "%", [{ t: "2026-11-05T00:00:00Z", v: -3 }, { t: "2026-11-07T00:00:00Z", v: 0.1 }]),
      stat("erased", "Value erased", "USD trillions", [{ t: "2026-11-05T00:00:00Z", v: 2 }, { t: "2026-11-07T00:00:00Z", v: 13 }]),
      stat("halts", "Halts", "halts", []),
    ] },
    w2: { metric: "nasdaq", label: "Nasdaq", unit: "%", points: [
      { t: "2026-11-05T00:00:00Z", v: -5, sources: ["s1"] },
      { t: "2026-11-05T12:00:00Z", v: -4, sources: ["s2"] },
      { t: "2026-11-06T00:00:00Z", v: 1, sources: ["s3"] },
    ] },
    w3: companies,
    w4: responses,
  },
} as unknown as BoardData;

describe("finance data", () => {
  const placed = placedWidgets(spec, data);

  it("skips hidden widgets", () => {
    expect(placed.map((p) => p.widget.id)).toEqual(["w1", "w2", "w3", "w4"]);
  });

  it("builds one series per metric with two or more reports, preferring trend points with sources", () => {
    const series = metricSeries(placed);
    expect(series.map((s) => s.key)).toEqual(["nasdaq", "dow", "erased"]);
    expect(series[0].points.map((p) => p.sources)).toEqual([["s1"], ["s2"], ["s3"]]);
    expect(unitGroups(series).map((g) => [g.unit, g.series.length])).toEqual([["%", 2], ["USD trillions", 1]]);
  });

  it("turns tables with a time column into lanes", () => {
    const lanes = tableLanes(placed);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ key: "w4", label: "Responses", events: [{ title: "Federal Reserve", detail: "Warned of overvaluation", status: "Warning issued" }] });
  });

  it("merges rows about the same company and ranks by the size of the fall", () => {
    const r = ranking(placed)!;
    expect(r.widget.id).toBe("w3");
    expect(r.magnitude).toBe(true);
    expect(r.entries.map((e) => [e.name, e.ticker, e.value, e.reports.length])).toEqual([
      ["Micron", "MU", 16.63, 2],
      ["Advanced Micro Devices", "AMD", 15.5, 2],
      ["Tesla Inc.", "TSLA", 10.2, 1],
      ["Nvidia", null, null, 1],
    ]);
  });

  it("treats placeholders as missing", () => {
    expect([filled("N/A"), filled("Not specified"), filled(" – "), filled("$430b")]).toEqual([null, null, null, "$430b"]);
    expect([parseNumber("-16.63%"), parseNumber("17%"), parseNumber("Not reported"), parseNumber("$430b")]).toEqual([-16.63, 17, null, 430]);
    expect(rankEntries(companies, "company", null, "drop", false).find((e) => e.name === "Tesla Inc.")?.value).toBe(-10.2);
  });

  it("gives closed markets little room and spreads the news that came in while they were closed", () => {
    const h = (iso: string) => Date.parse(iso);
    // Two sessions of three hourly bars, a night between them.
    const bars = ["2026-11-05T14:30Z", "2026-11-05T15:30Z", "2026-11-05T16:30Z", "2026-11-06T14:30Z", "2026-11-06T15:30Z", "2026-11-06T16:30Z"].map(h);
    const plain = sessionAxis(bars, bars[0], bars[5]);
    expect([plain.pos(bars[1]), plain.pos(bars[2]), plain.pos(bars[3]), plain.span]).toEqual([1, 2, 3.5, 5.5]);
    // Two events after the last bar sit three units apart, not where clock time would put them.
    const late = [h("2026-11-07T01:00Z"), h("2026-11-07T02:00Z")];
    const axis = sessionAxis(bars, bars[0], late[1], late);
    expect([axis.pos(late[0]), axis.pos(late[1])]).toEqual([8.5, 11.5]);
  });

  it("measures the move from the close before a moment to the end of the next session", () => {
    const h = (iso: string) => Date.parse(iso);
    const pts: [number, number][] = [[h("2026-11-04T20:30Z"), 100], [h("2026-11-05T14:30Z"), 98], [h("2026-11-05T20:30Z"), 95], [h("2026-11-06T14:30Z"), 97]];
    expect(reaction(pts, h("2026-11-05T00:00Z"))).toEqual({ from: pts[0], to: pts[2] });
    expect(reaction(pts, h("2026-11-07T00:00Z"))).toBeNull();
  });

  it("finds tickers and the index a figure is about", () => {
    expect([tickerOf("Micron", "MU"), tickerOf("Nvidia", null), tickerOf("Advanced Micro Devices", ""), tickerOf("Acme Robotics", null)]).toEqual(["MU", "NVDA", "AMD", null]);
    expect([tickerOf("BNP Paribas", "BNP"), tickerOf("Société Générale", null), tickerOf("Crédit Agricole SA", "ACA")]).toEqual(["BNP.PA", "GLE.PA", "ACA.PA"]);
    expect([indexOfLabel("S&P 500 Change"), indexOfLabel("Dow Jones Change"), indexOfLabel("VIX Volatility Index"), indexOfLabel("Market Value Erased")]).toEqual(["^GSPC", "^DJI", "^VIX", null]);
  });

  it("picks the currency or index each finance topic is about, and nothing for a Wall Street board", () => {
    expect(assetsIn("Egyptian pound hits record low near 56 per dollar")).toEqual(["EGP=X"]);
    expect(assetsIn("Ueno Bank collapse topples Paraguay's president")).toEqual(["PYG=X"]);
    expect(assetsIn("French 10-year yield tops 5% amid unrest")).toEqual(["^FCHI", "^STOXX50E", "EURUSD=X"]);
    expect(assetsIn("Post-Midterm AI Stock Sell-Off")).toEqual([]);
  });

  it("leaves out a figure read a thousand times too big, and keeps real jumps", () => {
    const pts = [4.9, 5, 4952, 4.97, 4904, 5, 4780, 4.77, 4.69, 4.89].map((v) => ({ v }));
    expect(inScale(pts).map((p) => p.v)).toEqual([4.9, 5, 4.97, 5, 4.77, 4.69, 4.89]);
    const moves = [0.05, -0.04, 0.06, 6, 0.03].map((v) => ({ v }));
    expect(inScale(moves)).toEqual(moves);
  });
});
