"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SourceMark } from "@/components/sources/source-mark";
import { sourceLabel } from "@/lib/source-brand";
import type { Source } from "@/lib/spec";
import type { Lane, LaneEvent, Series, SeriesPoint } from "./finance-data";

/** One color per series, stable across unit switches: ink first, then the categorical palette. */
const PALETTE = [2, 1, 4, 5, 6, 7, 8, 3];
export const seriesColor = (i: number) => `var(--sw-chart-${PALETTE[i % PALETTE.length]})`;

const M = { top: 14, right: 18, left: 46 };
const PLOT_H = 250;
const LANE_H = 38;
const AXIS_H = 24;
const DAY = 86_400_000;

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, "") || "0";
export const withUnit = (v: number, unit: string | null) => (unit === "%" ? `${fmt(v)}%` : unit ? `${fmt(v)} ${unit}` : fmt(v));

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

type Hover =
  | { kind: "point"; x: number; y: number; series: Series; point: SeriesPoint; color: string }
  | { kind: "event"; x: number; y: number; lane: Lane; event: LaneEvent };

/**
 * Figures that share a unit, drawn on one time axis, with dated rows (regulator actions, key events) as lanes
 * under the same axis. Every dot is one reported figure; lines join reports in time order.
 */
export function MarketChart({ series, visible, colorOf, lanes, sources, label }: {
  /** Every series on the board, so the time axis stays put when the visible set changes. */
  series: Series[];
  visible: Series[];
  colorOf: (key: string) => string;
  lanes: Lane[];
  sources: Map<string, Source>;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = M.top + PLOT_H + 12 + lanes.length * LANE_H + AXIS_H;
  const innerW = Math.max(0, width - M.left - M.right);

  const { x, y, xTicks, yTicks } = useMemo(() => {
    const times = [...series.flatMap((s) => s.points.map((p) => p.t)), ...lanes.flatMap((l) => l.events.map((e) => e.t))];
    let t0 = Math.min(...times);
    let t1 = Math.max(...times);
    // Nothing to place: any fixed window will do, the plot stays empty.
    if (!Number.isFinite(t0)) [t0, t1] = [0, 7 * DAY];
    if (t1 - t0 < DAY) [t0, t1] = [t0 - DAY / 2, t1 + DAY / 2];
    const pad = (t1 - t0) * 0.03;
    [t0, t1] = [t0 - pad, t1 + pad];
    const values = [0, ...visible.flatMap((s) => s.points.map((p) => p.v))];
    let v0 = Math.min(...values);
    let v1 = Math.max(...values);
    if (v1 - v0 === 0) [v0, v1] = [v0 - 1, v1 + 1];
    const step = niceStep(v1 - v0, 4);
    v0 = Math.floor(v0 / step) * step;
    v1 = Math.ceil(v1 / step) * step;
    const x = (t: number) => M.left + ((t - t0) / (t1 - t0)) * innerW;
    const y = (v: number) => M.top + PLOT_H - ((v - v0) / (v1 - v0)) * PLOT_H;
    const yTicks: number[] = [];
    for (let v = v0; v <= v1 + step / 2; v += step) yTicks.push(Number(v.toFixed(6)));
    const days = Math.max(1, Math.ceil((t1 - t0) / DAY / Math.max(1, Math.floor(innerW / 90))));
    const xTicks: number[] = [];
    for (let t = Math.ceil(t0 / DAY) * DAY; t <= t1; t += days * DAY) xTicks.push(t);
    return { x, y, xTicks, yTicks };
  }, [series, visible, lanes, innerW]);

  const plotBottom = M.top + PLOT_H;
  const laneTop = (i: number) => plotBottom + 12 + i * LANE_H;
  const unit = visible[0]?.unit ?? null;
  const show = (h: Hover) => setHover(h);
  const hide = () => setHover(null);

  return (
    <div ref={box} className="fd-fin-chart" onPointerLeave={hide}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label}>
          {yTicks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "zero" : "grid"} x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
              <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end">{withUnit(v, unit)}</text>
            </g>
          ))}
          {hover?.kind === "event" ? <line className="guide" x1={hover.x} x2={hover.x} y1={M.top} y2={laneTop(lanes.length) - 6} /> : null}
          {visible.map((s) => {
            const color = colorOf(s.key);
            const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                {s.points.map((p) => {
                  const active = hover?.kind === "point" && hover.point === p;
                  return (
                    <g key={`${p.t}-${p.v}`} className="hit" tabIndex={0} role="button"
                      aria-label={`${s.label}: ${withUnit(p.v, s.unit)} on ${timeFmt.format(p.t)} UTC`}
                      onPointerEnter={() => show({ kind: "point", x: x(p.t), y: y(p.v), series: s, point: p, color })}
                      onFocus={() => show({ kind: "point", x: x(p.t), y: y(p.v), series: s, point: p, color })} onBlur={hide}>
                      <circle cx={x(p.t)} cy={y(p.v)} r={12} fill="transparent" />
                      <circle cx={x(p.t)} cy={y(p.v)} r={active ? 5.5 : 4} fill="var(--sw-background)" stroke={color} strokeWidth={2} />
                    </g>
                  );
                })}
              </g>
            );
          })}
          {lanes.map((lane, i) => {
            const top = laneTop(i);
            const mid = top + 23;
            return (
              <g key={lane.key}>
                <line className="lane-rule" x1={M.left} x2={width - M.right} y1={top} y2={top} />
                <text x={M.left} y={top + 10} style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{lane.label}</text>
                <line className="grid" x1={M.left} x2={width - M.right} y1={mid} y2={mid} strokeDasharray="1 4" />
                {lane.events.map((e) => {
                  const cx = x(e.t);
                  const warn = /warn|alert|halt|ban|emergency/i.test(e.status ?? "");
                  return (
                    <g key={e.id} className="hit" tabIndex={0} role="button" aria-label={`${lane.label}: ${e.title}, ${dayFmt.format(e.t)}`}
                      onPointerEnter={() => show({ kind: "event", x: cx, y: mid, lane, event: e })}
                      onFocus={() => show({ kind: "event", x: cx, y: mid, lane, event: e })} onBlur={hide}>
                      <circle cx={cx} cy={mid} r={12} fill="transparent" />
                      {lane.kind === "table" ? (
                        <rect x={cx - 6} y={mid - 6} width={12} height={12} transform={`rotate(45 ${cx} ${mid})`}
                          fill={warn ? "var(--sw-warning)" : "var(--sw-foreground)"} stroke="var(--sw-background)" strokeWidth={1.5} />
                      ) : (
                        <circle cx={cx} cy={mid} r={5} fill="var(--sw-background)" stroke="var(--sw-foreground)" strokeWidth={2} />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle">{dayFmt.format(t)}</text>
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {hover ? <HoverCard hover={hover} width={width} sources={sources} /> : null}
    </div>
  );
}

function HoverCard({ hover, width, sources }: { hover: Hover; width: number; sources: Map<string, Source> }) {
  const cardW = Math.min(320, width - 16);
  const left = hover.x + 16 + cardW > width ? Math.max(8, hover.x - 16 - cardW) : hover.x + 16;
  const top = Math.max(0, hover.y - 40);
  return (
    <div className="fd-fin-tip" style={{ left, top }} role="status">
      {hover.kind === "point" ? (
        <>
          <div className="fd-fin-kicker" style={{ color: hover.color }}>{hover.series.label}</div>
          <div className="fd-fin-tip__title fd-fin-mono">{withUnit(hover.point.v, hover.series.unit)}</div>
          <dl className="fd-fin-tip__rows">
            <Row label="Reported">{timeFmt.format(hover.point.t)} UTC</Row>
          </dl>
          <Cited ids={hover.point.sources} sources={sources} />
        </>
      ) : (
        <>
          <div className="fd-fin-kicker">{hover.lane.label}</div>
          <div className="fd-fin-tip__title">{hover.event.title}</div>
          {hover.event.detail ? <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.4 }}>{hover.event.detail}</p> : null}
          <dl className="fd-fin-tip__rows">
            <Row label="Date">{dayFmt.format(hover.event.t)}</Row>
            {hover.event.status ? <Row label="Status">{hover.event.status}</Row> : null}
          </dl>
          {hover.event.evidence?.quote ? <blockquote className="fd-fin-tip__quote">“{hover.event.evidence.quote}”</blockquote> : null}
          <Cited ids={hover.event.sources} sources={sources} />
        </>
      )}
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="fd-fin-tip__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The outlets behind an item, as logo and name. */
export function Cited({ ids, sources }: { ids: string[]; sources: Map<string, Source> }) {
  const list = [...new Set(ids)].map((id) => sources.get(id)).filter((s): s is Source => !!s).slice(0, 3);
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 10 }}>
      {list.map((s) => (
        <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }} className="text-muted-foreground">
          <SourceMark source={s} size="xs" />
          {sourceLabel(s)}
        </span>
      ))}
    </div>
  );
}
