import type { Source, StatItem, TrendData } from "@/lib/spec";
import { hostOf } from "@/lib/source-brand";
import { toMs } from "@/lib/time";
import { reportedTrendValue } from "@/components/widgets/cyber-chart-data";
import { legacyMetricRole } from "./cyber-user-summary";

/** Select one existing, sourced time series; never derive recovery percentages from unrelated totals. */
export function selectCyberTrend(trends: TrendData[], metrics: StatItem[], sources: Map<string, Source>): TrendData | undefined {
  const structured = metrics.some(metric => metric.cyberRole != null);
  const rank = { recovery: 0, response: 1, impact: 2 };
  const candidates = trends.flatMap(trend => {
    const metric = metrics.find(item => item.key === trend.metric);
    const role = metric?.cyberRole ?? (metric && !structured ? legacyMetricRole(metric) : undefined);
    // Percent/ratio histories do not carry their denominator or population in the current schema.
    if (!metric || !role || role === "context" || metric.conflict?.length || !trend.unit?.trim()
      || /%|percent|ratio|coverage/i.test(`${trend.unit} ${trend.metric} ${trend.label}`)) return [];
    const byTime = new Map<number, TrendData["points"][number]>();
    for (const point of trend.points) {
      const time = toMs(point.t);
      const ids = point.sources.filter(id => { const source = sources.get(id); return source && source.via !== "x" && hostOf(source.url); });
      const value = reportedTrendValue({ ...point, sources: ids }, trend.unit, sources);
      // Keep incomplete or conflicting series in Details, rather than silently removing reports for the main chart.
      if (time === null || value === undefined || !Number.isFinite(value) || !ids.length) return [];
      const prior = byTime.get(time);
      if (prior && prior.v !== value) return [];
      byTime.set(time, { t: point.t, v: value, sources: [...new Set([...(prior?.sources ?? []), ...ids])] });
    }
    if (byTime.size < 3) return [];
    const points = [...byTime.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
    return [{ data: { ...trend, unit: /^USD(?:\s|$)/i.test(trend.unit) ? "USD" : trend.unit, points }, rank: rank[role] }];
  });
  candidates.sort((a, b) => a.rank - b.rank || b.data.points.length - a.data.points.length || a.data.metric.localeCompare(b.data.metric));
  return candidates[0]?.data;
}
