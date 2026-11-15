import type { Source, StatItem, TableData } from "@/lib/spec";
import { toMs } from "@/lib/time";

export type MapFigure = Pick<StatItem, "key" | "label" | "valueText" | "unit" | "tone"> & {
  update?: { at: string; sourceIds: string[] };
};

/** Use the latest dated, cited update in a restriction table, where each row is a report rather than a unique area. */
export function latestRestrictionFigure(tables: TableData[], sources: ReadonlyMap<string, Source>): MapFigure | undefined {
  let result: MapFigure | undefined;
  let newestAt = -Infinity;
  for (const table of tables) {
    const status = table.columns.find((column) => column.kind === "status");
    if (!status || !table.columns.some((column) => column.key === "lifted-at" && column.kind === "time")) continue;

    for (const row of table.rows) {
      const at = row.asOf;
      const timestamp = toMs(at);
      const value = row.cells[status.key]?.trim();
      if (!at?.includes("T") || timestamp === null || timestamp <= newestAt || !value) continue;
      const sourceIds = (row.sources ?? []).filter((id) => sources.has(id));
      if (!sourceIds.length) continue;

      newestAt = timestamp;
      result = {
        key: "latest-restriction",
        label: "Latest restriction status",
        valueText: value,
        unit: null,
        tone: /^lifted$/i.test(value) ? "ok" : "info",
        update: { at, sourceIds },
      };
    }
  }
  return result;
}


const amountPattern = /^[+-]?\d+(?:\.\d+)?[+%]?$/u;
const genericWords = new Set(["in", "of", "the", "by", "over", "last", "people", "person", "total", "number"]);

function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/(\d)[, ](?=\d{3}(?!\d))/gu, "$1");
}

function metricWords(text: string) {
  return (normalize(text).match(/\p{L}+/gu) ?? []).filter((word) => !genericWords.has(word)).map((word) => {
    if (/^(dead|died|death[s]?|fatalit(?:y|ies))$/u.test(word)) return "death";
    if (word.startsWith("evacuat")) return "evacuate";
    return word.replace(/s$/u, "");
  });
}

function appearsInSummary(item: StatItem, clauses: string[]) {
  const value = normalize(item.valueText.trim());
  const keywords = metricWords(item.label);
  if (!amountPattern.test(value) || !keywords.length) return false;
  const unit = item.unit?.trim();

  // A matching number alone may describe another metric. Only use clauses that unambiguously pair it with the label.
  return clauses.some((clause) => {
    const amounts = clause.match(/[+-]?\d+(?:\.\d+)?[+%]?/gu);
    if (!amounts?.includes(value)) return false;
    if (unit ? !clause.includes(normalize(`${value} ${unit}`)) : amounts.length !== 1) return false;
    const words = metricWords(clause);
    return keywords.every((word) => words.includes(word));
  });
}

export function selectMapFigures(items: StatItem[], summary?: string) {
  const clauses = normalize(summary ?? "").split(/[,;!?]|\.(?!\d)|\b(?:and|but|while)\b/u);
  const figures: StatItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const identity = normalize(item.label).trim() || item.key;
    if (seen.has(identity) || appearsInSummary(item, clauses)) continue;
    seen.add(identity);
    figures.push(item);
    if (figures.length === 3) break;
  }
  return figures;
}
