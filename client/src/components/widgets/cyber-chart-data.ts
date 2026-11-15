import type { Source, TrendData } from "@/lib/spec";

const dollarScales: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** Resolve scaled dollar readings only when the cited text confirms which amount was meant. */
export function reportedTrendValue(point: TrendData["points"][number], unit: string | null | undefined, sources: Map<string, Source>) {
  if (!Number.isFinite(point.v)) return undefined;
  if (!/^USD\s+(?:thousand|million|billion|trillion)s?$/i.test(unit?.trim() ?? "")) return point.v;
  const matches = new Set<number>();
  for (const id of point.sources) {
    const source = sources.get(id);
    const evidence = `${source?.title ?? ""} ${source?.snippet ?? ""}`;
    for (const match of evidence.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|[kmbt])\b/gi)) {
      const nominal = Number(match[1].replace(/,/g, ""));
      const prefix = match[2].toLowerCase();
      const amount = Math.round(nominal * dollarScales[prefix === "thousand" ? "k" : prefix[0]] * 100) / 100;
      if (point.v === amount) return amount;
      if (point.v === nominal) matches.add(amount);
    }
  }
  return matches.size === 1 ? matches.values().next().value : undefined;
}

