import { shortTime, toMs } from "@/lib/time";

export type Point = { t: string; v: number };

/** Points with valid times, oldest first. */
export function cleanPoints(points: Point[]): { x: number; v: number; t: string }[] {
  return points
    .map((p) => ({ x: toMs(p.t), v: p.v, t: p.t }))
    .filter((p): p is { x: number; v: number; t: string } => p.x !== null && Number.isFinite(p.v))
    .sort((a, b) => a.x - b.x);
}

/** SVG path through the points, scaled into a width x height box with padding. */
export function linePath(points: Point[], width: number, height: number, pad = 2) {
  const pts = cleanPoints(points);
  if (pts.length === 0) return { d: "", dots: [] as { cx: number; cy: number }[], min: 0, max: 0 };
  const xs = pts.map((p) => p.x);
  const vs = pts.map((p) => p.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const sx = (x: number) => (maxX === minX ? width / 2 : pad + ((x - minX) / (maxX - minX)) * (width - pad * 2));
  const sy = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) / (max - min)) * (height - pad * 2));
  const dots = pts.map((p) => ({ cx: Number(sx(p.x).toFixed(2)), cy: Number(sy(p.v).toFixed(2)) }));
  const d = dots.map((p, i) => `${i ? "L" : "M"}${p.cx} ${p.cy}`).join(" ");
  return { d, dots, min, max };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** One sentence a screen reader can say instead of the chart. */
export function trendSummary(label: string, points: Point[], unit: string | null): string {
  const pts = cleanPoints(points);
  if (pts.length === 0) return `${label}: no figures yet.`;
  const u = unit ? ` ${unit}` : "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length === 1) return `${label}: ${fmt(last.v)}${u} at ${shortTime(last.t)} UTC.`;
  const dir = last.v > first.v ? "rose" : last.v < first.v ? "fell" : "stayed";
  const range = dir === "stayed" ? `at ${fmt(last.v)}${u}` : `from ${fmt(first.v)} to ${fmt(last.v)}${u}`;
  return `${label} ${dir} ${range} between ${shortTime(first.t)} and ${shortTime(last.t)} UTC, over ${pts.length} reports.`;
}
