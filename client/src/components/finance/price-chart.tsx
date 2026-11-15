"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Source } from "@/lib/spec";
import { nyDay, reaction, sessionAxis, type Lane, type LaneEvent } from "./finance-data";
import { Cited, Row } from "./market-chart";

/** One price series: hourly closes, drawn as the change since the window opens. */
export type PriceLine = { key: string; label: string; color: string; points: [number, number][]; dash?: string };

/**
 * Line colors. The indices get ink, blue and orange; stocks cyan, green and grey, dashed once those run out.
 * Purple and red are kept for the event lanes.
 */
const INDEX_PALETTE = [2, 1, 4];
const STOCK_PALETTE = [7, 3, 8];
export const lineStyle = (i: number, index: boolean) => {
  const palette = index ? INDEX_PALETTE : STOCK_PALETTE;
  return { color: `var(--sw-chart-${palette[i % palette.length]})`, dash: !index && i >= palette.length ? "5 3" : undefined };
};

/** The left gutter names each layer: the event lanes, the prices and the VIX pane. */
const M = { left: 128, right: 64 };
const RAIL_H = 48;
const BAND_H = 40;
const RAILS_GAP = 8;
const PLOT_H = 290;
const VIX_H = 84;
const PANE_GAP = 16;
const AXIS_H = 24;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const etTime = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const etDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const utcDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const level = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 });
export const pct = (v: number, digits = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;

/**
 * A row dated without a time of day ("2026-11-05") happened sometime that day: it is drawn mid-session, and its
 * market reaction is the whole day, from the close before.
 */
const dateOnly = (t: number) => t % DAY === 0;
const placeOf = (t: number) => (dateOnly(t) ? t + 17 * HOUR : t);
const reactionFrom = (t: number) => (dateOnly(t) ? t : placeOf(t));
const when = (t: number) => (dateOnly(t) ? utcDay.format(t) : `${etTime.format(t)} ET`);

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

function ticks(lo: number, hi: number, count: number) {
  if (hi - lo === 0) [lo, hi] = [lo - 1, hi + 1];
  const step = niceStep(hi - lo, count);
  const v0 = Math.floor(lo / step) * step;
  const v1 = Math.ceil(hi / step) * step;
  const list: number[] = [];
  for (let v = v0; v <= v1 + step / 2; v += step) list.push(Number(v.toFixed(6)));
  return { v0, v1, list };
}

/** Index of the last point at or before t, or -1. */
function at(points: [number, number][], t: number) {
  let lo = 0;
  let hi = points.length - 1;
  if (!points.length || points[0][0] > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type Pin = LaneEvent & { lane: Lane; place: number; x: number; rail: number; nudge: number };
type Hover = { kind: "bar"; i: number } | { kind: "pin"; pin: Pin };

/**
 * Prices as the change since the window opens, hour by hour on a trading-time axis (nights and weekends take
 * little room), with the board's dated actions and key events pinned onto the lines where they happened.
 * Hovering an hour reads every line; hovering a pin shows what happened and how prices moved in the next session.
 */
export function PriceChart({ bars, from, to, lines, vix, lanes, sources, label }: {
  /** Every bar time on the board's market data, so the axis stays put when lines are toggled. */
  bars: number[];
  from: number;
  to: number;
  /** The lines to draw. The first carries the pins. */
  lines: PriceLine[];
  /** The volatility index, drawn as a level in its own pane. */
  vix: PriceLine | null;
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

  const windowBars = useMemo(() => bars.filter((t) => t >= from), [bars, from]);
  const places = useMemo(() => lanes.flatMap((l) => l.events.map((e) => placeOf(e.t))).filter((t) => t >= from && t <= to), [lanes, from, to]);
  const axis = useMemo(() => sessionAxis(windowBars, from, to, places), [windowBars, from, to, places]);
  const innerW = Math.max(0, width - M.left - M.right);
  const x = (t: number) => M.left + (axis.pos(t) / axis.span) * innerW;

  const shown = useMemo(
    () =>
      lines.flatMap((l) => {
        const pts = l.points.filter((p) => p[0] >= from);
        if (pts.length < 2) return [];
        const base = pts[0][1];
        return [{ ...l, pts, base, change: pts.map(([t, c]): [number, number] => [t, (c / base - 1) * 100]) }];
      }),
    [lines, from],
  );
  const vixPts = useMemo(() => vix?.points.filter((p) => p[0] >= from) ?? [], [vix, from]);
  const lead = shown[0] ?? null;

  // One lane per kind of event, the regulators' actions first, each with its own row above the prices.
  // A lane with nothing in the window is left out.
  const rails = useMemo(
    () => lanes.filter((l) => l.events.some((e) => placeOf(e.t) >= from && placeOf(e.t) <= to)).sort((a, b) => Number(a.kind !== "table") - Number(b.kind !== "table")),
    [lanes, from, to],
  );
  const pins = useMemo(
    () =>
      rails.flatMap((lane, rail) => {
        let prev = -Infinity;
        let step = 0;
        return lane.events
          .map((e) => ({ ...e, lane, place: placeOf(e.t) }))
          .filter((p) => p.place >= from && p.place <= to)
          .sort((a, b) => a.place - b.place)
          .map((p): Pin => {
            const px = M.left + (axis.pos(p.place) / axis.span) * innerW;
            // Marks closer than a marker's width step up and down inside their lane.
            step = px - prev < 14 ? (step + 1) % 3 : 0;
            prev = px;
            return { ...p, x: px, rail, nudge: [0, -9, 9][step] };
          });
      }),
    [rails, from, to, axis, innerW],
  );

  const railTop = (i: number) => 4 + i * RAIL_H;
  const plotTop = 4 + rails.length * RAIL_H + (rails.length ? RAILS_GAP : 6);
  const plotBottom = plotTop + PLOT_H;
  const vixTop = plotBottom + PANE_GAP;
  const chartBottom = vixPts.length > 1 ? vixTop + VIX_H : plotBottom;
  const height = chartBottom + AXIS_H;

  const yAxis = useMemo(() => ticks(Math.min(0, ...shown.flatMap((l) => l.change.map((p) => p[1]))), Math.max(0, ...shown.flatMap((l) => l.change.map((p) => p[1]))), 5), [shown]);
  const y = (v: number) => plotTop + PLOT_H - ((v - yAxis.v0) / (yAxis.v1 - yAxis.v0)) * PLOT_H;
  const vAxis = useMemo(() => (vixPts.length > 1 ? ticks(Math.min(...vixPts.map((p) => p[1])), Math.max(...vixPts.map((p) => p[1])), 2) : null), [vixPts]);
  const vy = (v: number) => (vAxis ? vixTop + VIX_H - ((v - vAxis.v0) / (vAxis.v1 - vAxis.v0)) * VIX_H : 0);

  /** The lead line's value where a pin sits, read along the drawn segment so the pin lands on the line. */
  const onLead = (t: number) => {
    if (!lead) return null;
    const c = lead.change;
    const i = at(c, t);
    if (i < 0) return c[0][1];
    if (i >= c.length - 1) return c[c.length - 1][1];
    const [t0, v0] = c[i];
    const [t1, v1] = c[i + 1];
    const f = (axis.pos(t) - axis.pos(t0)) / Math.max(1e-9, axis.pos(t1) - axis.pos(t0));
    return v0 + f * (v1 - v0);
  };

  const days = useMemo(() => {
    const list: number[] = [];
    let prev = "";
    for (const t of windowBars) {
      const d = nyDay(t);
      if (d !== prev) list.push(t);
      prev = d;
    }
    return list;
  }, [windowBars]);
  const dayLabels = useMemo(() => {
    const out: number[] = [];
    let last = -Infinity;
    for (const t of days) {
      const px = M.left + (axis.pos(t) / axis.span) * innerW;
      if (px - last >= 52) {
        out.push(t);
        last = px;
      }
    }
    return out;
  }, [days, axis, innerW]);

  const xs = useMemo(() => windowBars.map((t) => M.left + (axis.pos(t) / axis.span) * innerW), [windowBars, axis, innerW]);
  const nearest = (px: number) => {
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    return best;
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (!xs.length) return;
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setHover({ kind: "bar", i: nearest(e.clientX - rect.left) });
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    const i = hover?.kind === "bar" ? hover.i : xs.length - 1;
    const next = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? xs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setHover({ kind: "bar", i: Math.max(0, Math.min(xs.length - 1, next)) });
  };

  const lastBar = windowBars[windowBars.length - 1];
  const tailX = lastBar !== undefined ? x(lastBar) : null;
  const hoverBar = hover?.kind === "bar" ? windowBars[hover.i] : null;
  const pinReaction = hover?.kind === "pin" && lead ? reaction(lead.pts, reactionFrom(hover.pin.t)) : null;
  const flagY = (p: Pin) => railTop(p.rail) + BAND_H / 2 + p.nudge;

  return (
    <div ref={box} className="fd-fin-chart" onPointerLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label}>
          {tailX !== null && x(to) - tailX > 24 ? (
            <g>
              <rect className="closed" x={tailX} y={railTop(0)} width={x(to) - tailX} height={chartBottom - railTop(0)} />
              <text x={tailX + 6} y={plotTop + 14}>Since close</text>
            </g>
          ) : null}
          {pinReaction ? (
            <rect className="band" x={x(pinReaction.from[0])} y={plotTop} width={Math.max(2, x(pinReaction.to[0]) - x(pinReaction.from[0]))} height={chartBottom - plotTop} />
          ) : null}
          {rails.map((lane, i) => {
            const n = pins.filter((p) => p.rail === i).length;
            return (
              <g key={lane.key}>
                <rect className="rail" data-kind={lane.kind === "table" ? "regulator" : "key"} x={M.left} y={railTop(i)} width={innerW} height={BAND_H} rx={4} />
                <Gutter y={railTop(i)} height={BAND_H} lines={wrap(lane.label, 17)} sub={`${n} ${lane.kind === "table" ? (n === 1 ? "action" : "actions") : n === 1 ? "event" : "events"}`}
                  glyph={(top) => <Mark regulator={lane.kind === "table"} cx={5} cy={top} size={4.5} />} />
              </g>
            );
          })}
          <Gutter y={plotTop} lines={["Prices"]} sub={`% since ${etDay.format(from)}`} />
          {shown.map((l, i) => (
            <g key={l.key}>
              <line x1={0} x2={12} y1={plotTop + 40 + i * 16} y2={plotTop + 40 + i * 16} stroke={l.color} strokeWidth={2.5} strokeDasharray={l.dash ? "3 2" : undefined} />
              <text className="gutter-line" x={18} y={plotTop + 40 + i * 16} dy="0.32em">{l.label}</text>
            </g>
          ))}
          {days.map((t) => <line key={t} className="day" x1={x(t)} x2={x(t)} y1={plotTop} y2={chartBottom} />)}
          {yAxis.list.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "zero" : "grid"} x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
              <text x={width - M.right + 8} y={y(v)} dy="0.32em">{v === 0 ? "0%" : pct(v, Math.abs(yAxis.list[1] - yAxis.list[0]) < 1 ? 1 : 0)}</text>
            </g>
          ))}
          {shown.map((l) => (
            <path key={l.key} d={l.change.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("")}
              fill="none" stroke={l.color} strokeDasharray={l.dash} strokeWidth={l === lead ? 2.25 : 1.75} strokeLinejoin="round" opacity={hover?.kind === "pin" && l !== lead ? 0.45 : 1} />
          ))}
          {vAxis ? (
            <g>
              <rect className="pane" x={M.left} y={vixTop} width={innerW} height={VIX_H} />
              <Gutter y={vixTop} lines={[vix?.label ?? "VIX"]} sub="fear gauge, level" />
              <text className="gutter-value" x={0} y={vixTop + 48}>{level(vixPts[vixPts.length - 1][1])}</text>
              {vAxis.list.map((v) => (
                <g key={v}>
                  <line className="grid" x1={M.left} x2={width - M.right} y1={vy(v)} y2={vy(v)} />
                  <text x={width - M.right + 8} y={vy(v)} dy="0.32em">{v}</text>
                </g>
              ))}
              <path className="vix-area" d={`${vixPts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${vy(v).toFixed(1)}`).join("")}L${x(vixPts[vixPts.length - 1][0]).toFixed(1)},${vixTop + VIX_H}L${x(vixPts[0][0]).toFixed(1)},${vixTop + VIX_H}Z`} />
              <path d={vixPts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${vy(v).toFixed(1)}`).join("")} fill="none" stroke={vix?.color} strokeWidth={1.5} />
            </g>
          ) : null}
          {dayLabels.map((t) => <text key={t} x={x(t)} y={height - 6} textAnchor="start">{etDay.format(t)}</text>)}

          <rect className="overlay" x={M.left} y={plotTop} width={innerW} height={chartBottom - plotTop} tabIndex={0}
            aria-label="Prices by the hour. Use the arrow keys to move between hours."
            onPointerMove={onMove} onKeyDown={onKey} onBlur={() => setHover(null)} />
          {hoverBar !== null && hoverBar !== undefined ? (
            <g pointerEvents="none">
              <line className="guide" x1={x(hoverBar)} x2={x(hoverBar)} y1={plotTop} y2={chartBottom} />
              {shown.map((l) => {
                const i = at(l.change, hoverBar);
                return i < 0 ? null : <circle key={l.key} cx={x(l.change[i][0])} cy={y(l.change[i][1])} r={3.5} fill={l.color} stroke="var(--sw-background)" strokeWidth={1.5} />;
              })}
              {vAxis ? (() => {
                const i = at(vixPts, hoverBar);
                return i < 0 ? null : <circle cx={x(vixPts[i][0])} cy={vy(vixPts[i][1])} r={3} fill={vix?.color} stroke="var(--sw-background)" strokeWidth={1.5} />;
              })() : null}
            </g>
          ) : null}

          {pins.map((p) => {
            const v = onLead(p.place);
            const regulator = p.lane.kind === "table";
            const active = hover?.kind === "pin" && hover.pin.id === p.id && hover.pin.lane.key === p.lane.key;
            const show = () => setHover({ kind: "pin", pin: p });
            return (
              <g key={`${p.lane.key}-${p.id}`} className="hit pin" data-kind={regulator ? "regulator" : "key"} data-active={active ? "" : undefined} tabIndex={0} role="button"
                aria-label={`${p.lane.label}: ${p.title}, ${when(p.t)}`} onPointerEnter={show} onFocus={show} onBlur={() => setHover(null)}>
                <line className="pin-rule" x1={p.x} x2={p.x} y1={flagY(p) + 6} y2={chartBottom} />
                <circle cx={p.x} cy={flagY(p)} r={9} fill="transparent" />
                <Mark regulator={regulator} cx={p.x} cy={flagY(p)} size={active ? 6.5 : 5} />
                {v !== null ? (
                  <>
                    <circle cx={p.x} cy={y(v)} r={10} fill="transparent" />
                    <Mark regulator={regulator} cx={p.x} cy={y(v)} size={active ? 6.5 : 5} ring />
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {hover?.kind === "bar" && hoverBar !== undefined && hoverBar !== null ? (
        <Card x={x(hoverBar)} top={plotTop + 8} width={width}>
          <div className="fd-fin-kicker">{etTime.format(hoverBar)} ET</div>
          <dl className="fd-fin-tip__rows">
            {shown.map((l) => {
              const i = at(l.pts, hoverBar);
              if (i < 0) return null;
              const change = l.change[i][1];
              return (
                <Row key={l.key} label={<><i className="fd-fin-swatch" style={{ background: l.color }} />{l.label}</>}>
                  {level(l.pts[i][1])} <span className="fd-fin__delta" data-dir={change > 0 ? "up" : change < 0 ? "down" : "flat"}>{pct(change)}</span>
                </Row>
              );
            })}
            {vAxis ? (() => {
              const i = at(vixPts, hoverBar);
              return i < 0 ? null : <Row label={<><i className="fd-fin-swatch" style={{ background: vix?.color }} />{vix?.label}</>}>{level(vixPts[i][1])}</Row>;
            })() : null}
          </dl>
          <SameDay pins={pins} day={nyDay(hoverBar)} />
        </Card>
      ) : null}
      {hover?.kind === "pin" ? (
        <Card x={hover.pin.x} top={flagY(hover.pin) + 14} width={width}>
          <div className="fd-fin-kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width={12} height={12} aria-hidden><Mark regulator={hover.pin.lane.kind === "table"} cx={6} cy={6} size={4.5} /></svg>
            {hover.pin.lane.label}
          </div>
          <div className="fd-fin-tip__title">{hover.pin.title}</div>
          {hover.pin.detail ? <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.4 }}>{hover.pin.detail}</p> : null}
          <dl className="fd-fin-tip__rows">
            <Row label="When">{when(hover.pin.t)}</Row>
            {hover.pin.status ? <Row label="Status">{hover.pin.status}</Row> : null}
          </dl>
          <Reaction lines={shown} t={reactionFrom(hover.pin.t)} />
          {hover.pin.evidence?.quote ? <blockquote className="fd-fin-tip__quote">“{hover.pin.evidence.quote}”</blockquote> : null}
          <Cited ids={hover.pin.sources} sources={sources} />
        </Card>
      ) : null}
    </div>
  );
}

/** Regulators' actions are purple diamonds, key events red circles; on the price line the circle is a ring. */
function Mark({ regulator, cx, cy, size, ring = false }: { regulator: boolean; cx: number; cy: number; size: number; ring?: boolean }) {
  const fill = regulator ? "var(--fin-reg)" : "var(--fin-key)";
  return regulator ? (
    <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} transform={`rotate(45 ${cx} ${cy})`} fill={fill} stroke="var(--sw-background)" strokeWidth={ring ? 2 : 1.5} />
  ) : (
    <circle cx={cx} cy={cy} r={size} fill={ring ? "var(--sw-background)" : fill} stroke={fill} strokeWidth={ring ? 2.5 : 1.5} />
  );
}

/**
 * A layer's name in the left gutter: one or two lines of title, then a muted line under it. Given a height, the
 * block is centred in it (the event lanes); otherwise it hangs from the top (the panes).
 */
function Gutter({ y, height, lines, sub, glyph }: { y: number; height?: number; lines: string[]; sub: string; glyph?: (top: number) => ReactNode }) {
  const block = lines.length * 13 + 12;
  const top = y + (height ? (height - block) / 2 : 2) + 6.5;
  const left = glyph ? 16 : 0;
  return (
    <g>
      {glyph?.(top)}
      {lines.map((line, i) => <text key={line} className="gutter-title" x={left} y={top + i * 13} dy="0.32em">{line}</text>)}
      <text className="gutter-sub" x={left} y={top + lines.length * 13} dy="0.32em">{sub}</text>
    </g>
  );
}

/** A label in at most two lines of about `width` characters. */
function wrap(label: string, width: number): string[] {
  const out: string[] = [];
  for (const word of label.split(/\s+/)) {
    const last = out[out.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= width) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out.length > 2 ? [out[0], `${out.slice(1).join(" ").slice(0, width - 1)}…`] : out;
}

function Card({ x, top, width, children }: { x: number; top: number; width: number; children: ReactNode }) {
  const cardW = Math.min(330, width - 16);
  const left = x + 18 + cardW > width ? Math.max(8, x - 18 - cardW) : x + 18;
  return <div className="fd-fin-tip" style={{ left, top, width: cardW }} role="status">{children}</div>;
}

/** What each drawn line did from the last close before a moment to the end of the next session after it. */
function Reaction({ lines, t }: { lines: { key: string; label: string; color: string; pts: [number, number][] }[]; t: number }) {
  const rows = lines.map((l) => ({ l, r: reaction(l.pts, t) }));
  if (!rows.length) return null;
  const closed = rows.every((x) => x.r === null);
  const close = rows.find((x) => x.r)?.r?.to[0];
  return (
    <div style={{ marginTop: 12 }}>
      <div className="fd-fin-kicker">{closed ? "Markets have not traded since" : `Market reaction · to the ${close ? etDay.format(close) : ""} close`}</div>
      {closed ? null : (
        <dl className="fd-fin-tip__rows" style={{ marginTop: 4 }}>
          {rows.map(({ l, r }) => {
            if (!r) return null;
            const change = (r.to[1] / r.from[1] - 1) * 100;
            return (
              <Row key={l.key} label={<><i className="fd-fin-swatch" style={{ background: l.color }} />{l.label}</>}>
                <span className="fd-fin__delta" data-dir={change > 0 ? "up" : change < 0 ? "down" : "flat"}>{pct(change)}</span>
              </Row>
            );
          })}
        </dl>
      )}
    </div>
  );
}

function SameDay({ pins, day }: { pins: Pin[]; day: string }) {
  const list = pins.filter((p) => nyDay(p.place) === day).slice(0, 3);
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="fd-fin-kicker">That day</div>
      <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 6 }}>
        {list.map((p) => (
          <li key={`${p.lane.key}-${p.id}`} style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr)", gap: 8, fontSize: 13, lineHeight: 1.35 }}>
            <svg width={12} height={12} style={{ marginTop: 3 }} aria-hidden><Mark regulator={p.lane.kind === "table"} cx={6} cy={6} size={4} /></svg>
            <span>{p.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
