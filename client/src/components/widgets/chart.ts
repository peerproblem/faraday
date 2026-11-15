import { shortTime, toMs } from "@/lib/time";

export type Point = { t: string; v: number };

/** Points with valid times, oldest first. */
export function cleanPoints<T extends Point>(points: T[]): (T & { x: number })[] {
  return points.flatMap((point) => {
    const x = toMs(point.t);
    return x === null || !Number.isFinite(point.v) ? [] : [{ ...point, x }];
  }).sort((a, b) => a.x - b.x);
}

/** SVG path through the points, scaled into a width x height box with padding. */
export function linePath(points: Point[], width: number, height: number, pad = 2, domain?: [number, number]) {
  const pts = cleanPoints(points);
  if (pts.length === 0) return { d: "", dots: [] as { cx: number; cy: number }[], min: 0, max: 0 };
  const xs = pts.map((p) => p.x);
  const vs = pts.map((p) => p.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const [min, max] = domain ?? [Math.min(...vs), Math.max(...vs)];
  const sx = (x: number) => (maxX === minX ? width / 2 : pad + ((x - minX) / (maxX - minX)) * (width - pad * 2));
  const sy = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) / (max - min)) * (height - pad * 2));
  const dots = pts.map((p) => ({ cx: Number(sx(p.x).toFixed(2)), cy: Number(sy(p.v).toFixed(2)) }));
  const d = dots.map((p, i) => `${i ? "L" : "M"}${p.cx} ${p.cy}`).join(" ");
  return { d, dots, min, max };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** One sentence a screen reader can say instead of the chart. */
export function trendSummary(
  label: string,
  points: Point[],
  unit: string | null,
  formatTime?: (t: string) => string,
): string {
  const pts = cleanPoints(points);
  if (pts.length === 0) return `${label}: no figures yet.`;
  const at = formatTime ?? shortTime;
  const suffix = formatTime ? "" : " UTC";
  const u = unit === "%" && formatTime ? "%" : unit ? ` ${unit}` : "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length === 1) return `${label}: ${fmt(last.v)}${u} at ${at(last.t)}${suffix}.`;
  const dir = last.v > first.v ? "rose" : last.v < first.v ? "fell" : "stayed";
  const range = dir === "stayed" ? `at ${fmt(last.v)}${u}` : `from ${fmt(first.v)} to ${fmt(last.v)}${u}`;
  return `${label} ${dir} ${range} between ${at(first.t)} and ${at(last.t)}${suffix}, over ${pts.length} reports.`;
}
