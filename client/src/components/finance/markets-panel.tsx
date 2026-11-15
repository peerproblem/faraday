"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToggleGroup } from "@/components/ui/toggle";
import type { MarketData } from "@/lib/market";
import { INDICES, indexOfLabel, VIX } from "@/lib/market-symbols";
import type { Source, StatItem } from "@/lib/spec";
import { nyDay, unitGroups, type Lane, type Series } from "./finance-data";
import { MarketChart, seriesColor } from "./market-chart";
import { lineStyle, PriceChart, type PriceLine } from "./price-chart";

const DAY = 86_400_000;
const RANGES = [
  { value: "1M", label: "1M", days: null },
  { value: "2W", label: "2W", days: 14 },
  { value: "1W", label: "1W", days: 7 },
] as const;
type Range = (typeof RANGES)[number]["value"];
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * What the markets panel shows, kept by the page so a figure in the tape can switch its line on. With market
 * prices: index and stock lines, the VIX pane, the event pins and the window. Without: the reported figures,
 * grouped by unit.
 */
export function useMarketView({ market, series, lanes }: { market: MarketData | null; series: Series[]; lanes: Lane[] }) {
  const lines = useMemo<(PriceLine & { index: boolean })[]>(() => {
    const list = (market?.lines ?? []).filter((l) => l.symbol !== VIX);
    const indices = list.filter((l) => INDICES.some((x) => x.symbol === l.symbol));
    const stocks = list.filter((l) => !indices.includes(l));
    return [
      ...indices.map((l, i) => ({ key: l.symbol, label: l.name, points: l.points, index: true, ...lineStyle(i, true) })),
      ...stocks.map((l, i) => ({ key: l.symbol, label: l.symbol, points: l.points, index: false, ...lineStyle(i, false) })),
    ];
  }, [market]);
  const vixLine = useMemo<PriceLine | null>(() => {
    const l = market?.lines.find((x) => x.symbol === VIX);
    return l ? { key: l.symbol, label: l.name, color: "var(--sw-foreground)", points: l.points } : null;
  }, [market]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [vixOn, setVixOn] = useState(true);
  const [lanesOff, setLanesOff] = useState<string[]>([]);
  const [range, setRange] = useState<Range>("2W");

  // Without prices: the reported figures that share a unit.
  const groups = useMemo(() => unitGroups(series), [series]);
  const [unit, setUnit] = useState<string | null>(null);
  const [on, setOn] = useState<string[] | null>(null);
  const group = groups.find((g) => g.unit === unit) ?? groups[0];

  const priced = lines.length > 0;
  const onLines = picked ?? lines.filter((l) => l.index).map((l) => l.key);
  const reportColor = (key: string) => seriesColor(Math.max(0, series.findIndex((s) => s.key === key)));
  const reportShown = group ? group.series.filter((s) => (on ?? group.series.map((x) => x.key)).includes(s.key)) : [];

  /** The line a figure in the tape stands for: an index by its label, or the reported series itself. */
  const lineOf = (stat: StatItem) => {
    if (!priced) return series.some((s) => s.key === stat.key) ? stat.key : null;
    const symbol = indexOfLabel(stat.label);
    return symbol && (symbol === VIX ? vixLine : lines.some((l) => l.key === symbol)) ? symbol : null;
  };
  const colorOf = (stat: StatItem) => {
    const key = lineOf(stat);
    if (!key) return reportColor(stat.key);
    if (!priced) return reportColor(key);
    return key === VIX ? (vixLine?.color ?? "") : (lines.find((l) => l.key === key)?.color ?? "");
  };
  const isShown = (stat: StatItem) => {
    const key = lineOf(stat);
    if (!key) return false;
    if (!priced) return reportShown.some((s) => s.key === key);
    return key === VIX ? vixOn : onLines.includes(key);
  };
  const focus = (stat: StatItem) => {
    const key = lineOf(stat);
    if (!key) return;
    if (!priced) {
      const g = groups.find((x) => x.series.some((s) => s.key === key));
      if (!g) return;
      setUnit(g.unit);
      setOn(g.unit === group?.unit && on ? [...new Set([...on, key])] : g.series.map((s) => s.key));
    } else if (key === VIX) setVixOn(true);
    else setPicked([...new Set([...onLines, key])]);
    document.getElementById("fd-fin-markets")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return {
    market, lines, vixLine, onLines, setPicked, vixOn, setVixOn, lanes, lanesOff, setLanesOff, range, setRange,
    series, groups, group, setUnit, on, setOn, reportShown, reportColor, priced, lineOf, colorOf, isShown, focus,
  };
}

export type MarketView = ReturnType<typeof useMarketView>;

const swatch = (color: string, label: string, dash?: string) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <i aria-hidden className="fd-fin-swatch" style={{ background: dash ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 6px)` : color }} />{label}
  </span>
);
const glyph = (lane: Lane, label: string) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <i aria-hidden className="fd-fin-glyph" data-kind={lane.kind === "table" ? "regulator" : "key"} />{label}
  </span>
);

/** The markets panel: prices and the board's events on one time axis, or the reported figures when there are no prices. */
export function MarketsPanel({ view, sources }: { view: MarketView; sources: Map<string, Source> }) {
  const { lines, vixLine, lanes, market } = view;
  const bars = useMemo(() => [...new Set(lines.flatMap((l) => l.points.map((p) => p[0])))].sort((a, b) => a - b), [lines]);
  if (!view.priced || !market || !bars.length) return <Reported view={view} sources={sources} />;

  const last = bars[bars.length - 1];
  const days = RANGES.find((r) => r.value === view.range)?.days ?? null;
  // The window opens with the first session on or after the cut, so every line starts on the same bar.
  const cut = days ? nyDay(last - days * DAY) : null;
  const from = (cut ? bars.find((t) => nyDay(t) >= cut) : undefined) ?? bars[0];
  const latestEvent = Math.max(...lanes.flatMap((l) => l.events.map((e) => e.t)).filter((t) => t <= market.fetchedAt));
  const to = Math.max(last, Number.isFinite(latestEvent) ? latestEvent : last);
  const shownLines = lines.filter((l) => view.onLines.includes(l.key));
  const shownLanes = lanes.filter((l) => !view.lanesOff.includes(l.key));
  const indices = lines.filter((l) => l.index);
  const stocks = lines.filter((l) => !l.index);

  return (
    <>
      <div className="fd-fin__head">
        <div>
          <div className="fd-fin-kicker">Markets</div>
          <h2 id="fd-fin-markets-h" className="fd-fin__h2">Prices and the news on one time axis</h2>
        </div>
        <SegmentedControl aria-label="Time window" size="sm" value={view.range} onValueChange={(v) => view.setRange(v as Range)} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
      </div>
      <div className="fd-fin__controls">
        <ToggleGroup multiple size="sm" variant="outline" aria-label="Indices" value={view.onLines.filter((k) => indices.some((l) => l.key === k))}
          onValueChange={(v) => view.setPicked([...v, ...view.onLines.filter((k) => stocks.some((l) => l.key === k))])}
          items={indices.map((l) => ({ value: l.key, label: swatch(l.color, l.label) }))} />
        {stocks.length ? (
          <ToggleGroup multiple size="sm" variant="outline" aria-label="Stocks" value={view.onLines.filter((k) => stocks.some((l) => l.key === k))}
            onValueChange={(v) => view.setPicked([...view.onLines.filter((k) => indices.some((l) => l.key === k)), ...v])}
            items={stocks.map((l) => ({ value: l.key, label: swatch(l.color, l.key, l.dash) }))} />
        ) : null}
        <ToggleGroup multiple size="sm" variant="outline" aria-label="Overlays"
          value={[...(view.vixOn && vixLine ? [vixLine.key] : []), ...lanes.filter((l) => !view.lanesOff.includes(l.key)).map((l) => l.key)]}
          onValueChange={(v) => {
            view.setVixOn(!!vixLine && v.includes(vixLine.key));
            view.setLanesOff(lanes.filter((l) => !v.includes(l.key)).map((l) => l.key));
          }}
          items={[
            ...lanes.map((l) => ({ value: l.key, label: glyph(l, l.label) })),
            ...(vixLine ? [{ value: vixLine.key, label: swatch(vixLine.color, `${vixLine.label} pane`) }] : []),
          ]} />
      </div>
      <PriceChart bars={bars} from={from} to={to} lines={shownLines} vix={view.vixOn ? vixLine : null} lanes={shownLanes} sources={sources}
        label={`${shownLines.map((l) => l.label).join(", ")}: change since ${dayFmt.format(from)}, hourly, with ${shownLanes.map((l) => l.label).join(" and ")} pinned where they happened`} />
      <p className="fd-fin-kicker" style={{ marginTop: 10, textTransform: "none", letterSpacing: 0 }}>
        Change since {dayFmt.format(from)}, hourly closes from Yahoo Finance (delayed). Markers sit on {shownLines[0]?.label ?? "the price"} where each action or event happened; hover one to see how prices moved in the next session, or hover the chart to read every line.
      </p>
    </>
  );
}

/** The fallback: the board's reported figures, grouped by unit, with the dated rows as lanes under the axis. */
function Reported({ view, sources }: { view: MarketView; sources: Map<string, Source> }) {
  const { groups, group, reportShown, lanes, series } = view;
  return (
    <>
      <div className="fd-fin__head">
        <div>
          <div className="fd-fin-kicker">Markets</div>
          <h2 id="fd-fin-markets-h" className="fd-fin__h2">{group ? group.label : "Timeline"} on one time axis</h2>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {groups.length > 1 ? (
            <SegmentedControl aria-label="Unit" size="sm" value={group.unit} onValueChange={(u) => { view.setUnit(u); view.setOn(null); }}
              options={groups.map((g) => ({ value: g.unit, label: g.label }))} />
          ) : null}
          {group && group.series.length > 1 ? (
            <ToggleGroup multiple size="sm" variant="outline" aria-label="Series to show" value={reportShown.map((s) => s.key)}
              onValueChange={(v) => view.setOn(v.length ? v : reportShown.map((s) => s.key))}
              items={group.series.map((s) => ({ value: s.key, label: swatch(view.reportColor(s.key), s.label) }))} />
          ) : null}
        </div>
      </div>
      <MarketChart series={series} visible={reportShown} colorOf={view.reportColor} lanes={lanes} sources={sources}
        label={`${reportShown.map((s) => s.label).join(", ")} over time, with ${lanes.map((l) => l.label).join(" and ")} on the same axis`} />
      <p className="fd-fin-kicker" style={{ marginTop: 10, textTransform: "none", letterSpacing: 0 }}>
        Each dot is one reported figure; lines join reports in time order. Diamonds and circles below mark dated actions and key events. Hover for the source.
      </p>
    </>
  );
}
