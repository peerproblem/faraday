"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToggleGroup } from "@/components/ui/toggle";
import type { MarketData } from "@/lib/market";
import { ASSETS, assetsIn, INDICES, indexOfLabel, VIX } from "@/lib/market-symbols";
import type { Source, StatItem } from "@/lib/spec";
import { nyDay, unitGroups, type Lane, type Series } from "./finance-data";
import { MarketChart, seriesColor } from "./market-chart";
import { lineStyle, type Pane, PriceChart, type PriceLine } from "./price-chart";

const DAY = 86_400_000;
const RANGES = [
  { value: "3M", label: "3M", days: null },
  { value: "1M", label: "1M", days: 31 },
  { value: "2W", label: "2W", days: 14 },
  { value: "1W", label: "1W", days: 7 },
] as const;
type Range = (typeof RANGES)[number]["value"];

/** The shortest window that still holds most of the board's events, so a story that broke weeks ago opens on its start. */
function openingRange(lanes: Lane[], now: number): Range {
  const times = lanes.flatMap((l) => l.events.map((e) => e.t)).filter((t) => t <= now).sort((a, b) => a - b);
  if (!times.length) return "2W";
  const middle = times[Math.floor((times.length - 1) / 2)];
  const fits = [...RANGES].reverse().find((r) => r.days !== null && r.days >= 14 && now - middle <= (r.days - 1) * DAY);
  return fits?.value ?? "3M";
}
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * What the markets panel shows, kept by the page so a figure in the tape can switch its line on. With market
 * prices: index, asset and stock lines, the VIX pane, the event pins and the window. Without: the reported
 * figures, grouped by unit.
 */
export function useMarketView({ market, series, lanes }: { market: MarketData | null; series: Series[]; lanes: Lane[] }) {
  // Markets the board names (a currency, a national index) come first, so they carry the event pins; then the indices, then stocks.
  const lines = useMemo<(PriceLine & { kind: "asset" | "index" | "stock" })[]>(() => {
    const list = (market?.lines ?? []).filter((l) => l.symbol !== VIX);
    const indices = list.filter((l) => INDICES.some((x) => x.symbol === l.symbol));
    const others = list.filter((l) => !indices.includes(l));
    const asset = (l: { symbol: string }) => ASSETS.some((x) => x.symbol === l.symbol);
    const styled = others.map((l, i) => ({ key: l.symbol, label: asset(l) ? l.name : l.symbol, points: l.points, kind: asset(l) ? ("asset" as const) : ("stock" as const), ...lineStyle(i, false) }));
    return [
      ...styled.filter((l) => l.kind === "asset"),
      ...indices.map((l, i) => ({ key: l.symbol, label: l.name, points: l.points, kind: "index" as const, ...lineStyle(i, true) })),
      ...styled.filter((l) => l.kind === "stock"),
    ];
  }, [market]);
  const vixLine = useMemo<Pane | null>(() => {
    const l = market?.lines.find((x) => x.symbol === VIX);
    return l ? { key: l.symbol, label: l.name, color: "var(--sw-foreground)", points: l.points, sub: "fear gauge, level", unit: null } : null;
  }, [market]);
  // A board about a market outside the US (a currency, the CAC 40) opens on that market; the US indices and the
  // VIX stay one click away.
  const abroad = lines.some((l) => l.kind === "asset");
  // Such a board's own reported figures (a bond yield, a spread) have no price feed; each can fill the pane under
  // the prices instead of the VIX. Figures a price line already shows are left out.
  const reportPanes = useMemo<Pane[]>(
    () => (abroad ? series : [])
      .filter((s) => s.points.length > 1 && !indexOfLabel(s.label) && !assetsIn(s.label).length)
      .map((s) => ({ key: `r:${s.key}`, label: s.label, color: "var(--sw-foreground)", points: s.points.map((p): [number, number] => [p.t, p.v]), sub: "as reported", unit: s.unit, reported: true })),
    [abroad, series],
  );
  const panes = useMemo(() => [...reportPanes, ...(vixLine ? [vixLine] : [])], [reportPanes, vixLine]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [paneKey, setPaneKey] = useState<string | null>(() => (abroad ? (reportPanes[0]?.key ?? null) : (vixLine?.key ?? null)));
  const pane = panes.find((x) => x.key === paneKey) ?? null;
  const [lanesOff, setLanesOff] = useState<string[]>([]);
  const [range, setRange] = useState<Range>(() => openingRange(lanes, market?.fetchedAt ?? 0));

  // Without prices: the reported figures that share a unit.
  const groups = useMemo(() => unitGroups(series), [series]);
  const [unit, setUnit] = useState<string | null>(null);
  const [on, setOn] = useState<string[] | null>(null);
  const group = groups.find((g) => g.unit === unit) ?? groups[0];

  const priced = lines.length > 0;
  // Abroad, the board's own stock index leads and its currency waits a click away; a board about a currency
  // opens on that currency.
  const assetKind = (key: string) => ASSETS.find((x) => x.symbol === key)?.kind;
  const homeIndex = lines.some((l) => assetKind(l.key) === "index");
  const onLines = picked ?? lines
    .filter((l) => (abroad ? l.kind === "asset" && (!homeIndex || assetKind(l.key) === "index") : l.kind !== "stock"))
    .map((l) => l.key);
  const reportColor = (key: string) => seriesColor(Math.max(0, series.findIndex((s) => s.key === key)));
  const reportShown = group ? group.series.filter((s) => (on ?? group.series.map((x) => x.key)).includes(s.key)) : [];

  /** The line a figure in the tape stands for: an index by its label, its own pane, or the reported series itself. */
  const lineOf = (stat: StatItem) => {
    if (!priced) return series.some((s) => s.key === stat.key) ? stat.key : null;
    if (panes.some((x) => x.key === `r:${stat.key}`)) return `r:${stat.key}`;
    const symbol = indexOfLabel(stat.label);
    return symbol && (symbol === VIX ? vixLine : lines.some((l) => l.key === symbol)) ? symbol : null;
  };
  const colorOf = (stat: StatItem) => {
    const key = lineOf(stat);
    if (!key) return reportColor(stat.key);
    if (!priced) return reportColor(key);
    return panes.find((x) => x.key === key)?.color ?? lines.find((l) => l.key === key)?.color ?? "";
  };
  const isShown = (stat: StatItem) => {
    const key = lineOf(stat);
    if (!key) return false;
    if (!priced) return reportShown.some((s) => s.key === key);
    return panes.some((x) => x.key === key) ? paneKey === key : onLines.includes(key);
  };
  const focus = (stat: StatItem) => {
    const key = lineOf(stat);
    if (!key) return;
    if (!priced) {
      const g = groups.find((x) => x.series.some((s) => s.key === key));
      if (!g) return;
      setUnit(g.unit);
      setOn(g.unit === group?.unit && on ? [...new Set([...on, key])] : g.series.map((s) => s.key));
    } else if (panes.some((x) => x.key === key)) setPaneKey(key);
    else setPicked([...new Set([...onLines, key])]);
    document.getElementById("fd-fin-markets")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return {
    market, lines, panes, pane, setPaneKey, onLines, setPicked, lanes, lanesOff, setLanesOff, range, setRange,
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
  const { lines, panes, pane, lanes, market } = view;
  // The axis keeps every hour any line traded; the rest (nights, weekends) folds into the closed gaps.
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
  const indices = lines.filter((l) => l.kind === "index");
  const stocks = lines.filter((l) => l.kind !== "index");

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
        <ToggleGroup multiple size="sm" aria-label="Indices" value={view.onLines.filter((k) => indices.some((l) => l.key === k))}
          onValueChange={(v) => view.setPicked([...v, ...view.onLines.filter((k) => stocks.some((l) => l.key === k))])}
          items={indices.map((l) => ({ value: l.key, label: swatch(l.color, l.label) }))} />
        {stocks.length ? (
          <ToggleGroup multiple size="sm" aria-label={stocks.some((l) => l.kind === "asset") ? "Markets and stocks" : "Stocks"} value={view.onLines.filter((k) => stocks.some((l) => l.key === k))}
            onValueChange={(v) => view.setPicked([...view.onLines.filter((k) => indices.some((l) => l.key === k)), ...v])}
            items={stocks.map((l) => ({ value: l.key, label: swatch(l.color, l.label, l.dash) }))} />
        ) : null}
        <ToggleGroup multiple size="sm" aria-label="Overlays"
          value={[...(pane ? [pane.key] : []), ...lanes.filter((l) => !view.lanesOff.includes(l.key)).map((l) => l.key)]}
          onValueChange={(v) => {
            // One pane at a time: a newly picked pane replaces the open one.
            const picked = panes.filter((x) => v.includes(x.key));
            view.setPaneKey((picked.find((x) => x.key !== pane?.key) ?? picked[0])?.key ?? null);
            view.setLanesOff(lanes.filter((l) => !v.includes(l.key)).map((l) => l.key));
          }}
          items={[
            ...lanes.map((l) => ({ value: l.key, label: glyph(l, l.label) })),
            ...panes.map((x) => ({ value: x.key, label: swatch(x.color, `${x.label} pane`) })),
          ]} />
      </div>
      <PriceChart bars={bars} from={from} to={to} lines={shownLines} pane={pane} lanes={shownLanes} sources={sources}
        label={`${shownLines.map((l) => l.label).join(", ")}: change since ${dayFmt.format(from)}, hourly, with ${shownLanes.map((l) => l.label).join(" and ")} pinned where they happened`} />
      <p className="fd-fin-note" style={{ marginTop: 16 }}>
        Change since {dayFmt.format(from)}, hourly closes from Yahoo Finance (delayed){pane?.reported ? `; the ${pane.label} pane shows the figures this board reported, joined in time order` : ""}. Markers sit on {shownLines[0]?.label ?? "the price"} where each action or event happened; hover one to see how prices moved in the next session, or hover the chart to read every line.
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
            <ToggleGroup multiple size="sm" aria-label="Series to show" value={reportShown.map((s) => s.key)}
              onValueChange={(v) => view.setOn(v.length ? v : reportShown.map((s) => s.key))}
              items={group.series.map((s) => ({ value: s.key, label: swatch(view.reportColor(s.key), s.label) }))} />
          ) : null}
        </div>
      </div>
      <MarketChart series={series} visible={reportShown} colorOf={view.reportColor} lanes={lanes} sources={sources}
        label={`${reportShown.map((s) => s.label).join(", ")} over time, with ${lanes.map((l) => l.label).join(" and ")} on the same axis`} />
      <p className="fd-fin-note" style={{ marginTop: 16 }}>
        Each dot is one reported figure; lines join reports in time order. Diamonds and circles below mark dated actions and key events. Hover for the source.
      </p>
    </>
  );
}
