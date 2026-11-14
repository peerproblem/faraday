import type { Fact, Source } from "../spec";

export const isSocialSource = (s: Source) => s.kind === "social" || s.sourceType === "social";

/** Quote verification proves a source said it, not that a social claim is true.
 * Social-bearing facts need an independently verified official/news citation on that same fact.
 * Legacy non-social facts keep their existing behavior. Unknown citations cannot promote a claim. */
export function trustedFacts<T extends Fact>(facts: T[], sources: Source[]): T[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return facts.filter((f) => {
    const cited = f.sourceIds.map((id) => byId.get(id));
    const social = cited.some((s) => s && isSocialSource(s));
    return !social || cited.some((s) => s && !isSocialSource(s) && (s.sourceType === "official" || s.sourceType === "news"));
  });
}

/** A corroborated report is represented by the independently extracted trusted fact, never
 * by copying unchecked social payload fields. Use conservative equality and a shared time window. */
export function corroboratedBy(report: Fact, trusted: Fact[]): boolean {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])));
    return JSON.stringify(value);
  };
  return trusted.some((f) => {
    if (f.kind !== report.kind || f.key !== report.key || !f.verified) return false;
    const a = report.asOf ? Date.parse(report.asOf) : NaN;
    const b = f.asOf ? Date.parse(f.asOf) : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) >= 3 * 60 * 60_000) return false;
    if (f.kind === "metric" && report.kind === "metric") {
      const fp = (f as Fact<"metric">).payload;
      const rp = (report as Fact<"metric">).payload;
      return f.valueNum !== null && f.valueNum === report.valueNum &&
        fp.unit === rp.unit && fp.scope === rp.scope;
    }
    return stable(f.payload) === stable(report.payload);
  });
}
