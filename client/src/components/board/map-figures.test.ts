import { describe, expect, it } from "vitest";
import type { Source, TableData } from "@/lib/spec";
import { latestRestrictionFigure } from "./map-figures";

const source: Source = {
  id: "s19",
  url: "https://yle.fi/",
  title: "Gulf of Finland restrictions",
  publisher: "Yle",
  kind: "web",
  publishedAt: null,
  fetchedAt: 0,
  snippet: null,
  relevance: null,
  sourceType: "news",
  via: "contextdev",
};
const sources = new Map([[source.id, source]]);
const restrictions: TableData = {
  columns: [
    { key: "status", label: "Status", kind: "status" },
    { key: "lifted-at", label: "Lifted at", kind: "time" },
  ],
  rows: [
    { id: "later-without-source", cells: { status: "Imposed" }, asOf: "2026-11-15T03:12:00+02:00", sources: ["unknown"] },
    { id: "lifted", cells: { status: "Lifted" }, asOf: "2026-11-11T07:20:00+02:00", sources: ["s19"] },
    { id: "older", cells: { status: "Imposed" }, asOf: "2026-11-11T02:15:00+02:00", sources: ["s19"] },
    { id: "imprecise", cells: { status: "Imposed" }, asOf: "2026-11-12", sources: ["s19"] },
  ],
};

describe("latest restriction figure", () => {
  it("uses the newest precisely timed update linked to a known source", () => {
    expect(latestRestrictionFigure([restrictions], sources)).toMatchObject({
      valueText: "Lifted",
      update: { at: "2026-11-11T07:20:00+02:00", sourceIds: ["s19"] },
    });
  });

  it("ignores unrelated status tables", () => {
    expect(latestRestrictionFigure([{ ...restrictions, columns: restrictions.columns.slice(0, 1) }], sources)).toBeUndefined();
  });
});
