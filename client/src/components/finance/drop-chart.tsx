"use client";

import { useState } from "react";
import { sourceLabel } from "@/lib/source-brand";
import type { Source } from "@/lib/spec";
import { filled, type RankEntry, type Ranking } from "./finance-data";
import { Cited, Row } from "./market-chart";

const PLOT_H = 360;
const MARK = 46;

const initials = (e: RankEntry) => e.ticker ?? e.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase();

/**
 * Companies placed by how far they fell: the deeper the mark, the bigger the reported drop. Rows about the
 * same company are one mark; its other reports sit on the same stem. Hover or focus a mark for the details.
 */
export function DropChart({ ranking, sources }: { ranking: Ranking; sources: Map<string, Source> }) {
  const [active, setActive] = useState<{ entry: RankEntry; x: number; y: number } | null>(null);
  const plotted = ranking.entries.filter((e) => e.value !== null);
  const shelf = ranking.entries.filter((e) => e.value === null);
  const percent = /%/.test(ranking.value.label);
  const values = plotted.flatMap((e) => e.reports.map((r) => r.value ?? 0));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = hi - lo > 20 ? 10 : 5;
  const top = ranking.magnitude ? 0 : Math.ceil(hi / step) * step;
  const bottom = ranking.magnitude ? Math.ceil(hi / step) * step || step : Math.floor(lo / step) * step;
  // A fall reads downwards: 0 at the top, the deepest drop at the bottom.
  const y = (v: number) => (ranking.magnitude ? (v / bottom) * PLOT_H : ((top - v) / (top - bottom || 1)) * PLOT_H);
  const ticks: number[] = [];
  for (let v = ranking.magnitude ? 0 : bottom; v <= (ranking.magnitude ? bottom : top); v += step) ticks.push(v);
  const label = (v: number) => `${ranking.magnitude && v ? "−" : ""}${v}${percent ? "%" : ""}`;
  const pad = MARK / 2 + 6;

  return (
    <div onPointerLeave={() => setActive(null)}>
      <div className="fd-fin-drop" style={{ height: PLOT_H + pad * 2 }}>
        <div className="fd-fin-drop__axis" aria-hidden>
          {ticks.map((v) => <span key={v} style={{ top: pad + y(v) }}>{label(v)}</span>)}
        </div>
        <div className="fd-fin-drop__plot" role="list" aria-label={`${ranking.widget.title}, by ${ranking.value.label}`}>
          {ticks.map((v) => <div key={v} className="fd-fin-drop__rule" data-zero={v === 0 ? "" : undefined} style={{ top: pad + y(v) }} />)}
          {plotted.map((e, i) => {
            const x = ((i + 0.5) / plotted.length) * 100;
            const reach = Math.max(...e.reports.map((r) => r.value ?? 0));
            const markY = pad + y(e.value!);
            const zeroY = pad + y(0);
            const open = () => setActive({ entry: e, x, y: markY });
            return (
              <div key={e.key} role="listitem">
                <div className="fd-fin-drop__stem" style={{ left: `${x}%`, top: Math.min(zeroY, pad + y(reach)), height: Math.abs(pad + y(reach) - zeroY) }} />
                {e.reports.filter((r) => r !== e.lead && r.value !== null).map((r) => (
                  <div key={r.rowId} className="fd-fin-drop__dot" style={{ left: `${x}%`, top: pad + y(r.value!) }} />
                ))}
                <button type="button" className="fd-fin-drop__mark" style={{ left: `${x}%`, top: markY, ["--mark" as string]: `${MARK}px` }}
                  aria-label={`${e.name}: ${e.lead.text} ${ranking.value.label}`} onPointerEnter={open} onFocus={open} onBlur={() => setActive(null)}>
                  {initials(e)}
                </button>
                <div className="fd-fin-drop__label" style={i < plotted.length - 1 || plotted.length < 3
                  ? { left: `calc(${x}% + ${MARK / 2 + 8}px)`, top: markY }
                  : { right: `calc(${100 - x}% + ${MARK / 2 + 8}px)`, top: markY, textAlign: "right" }}>
                  {e.name.length > 22 ? `${e.name.slice(0, 21)}…` : e.name}
                  <small>{label(Number(e.value!.toFixed(2)))}</small>
                </div>
              </div>
            );
          })}
          {active ? <DropCard entry={active.entry} ranking={ranking} sources={sources} x={active.x} y={active.y} /> : null}
        </div>
      </div>
      {shelf.length ? (
        <div className="fd-fin-drop__shelf">
          <span className="fd-fin-kicker">No {ranking.value.label.toLowerCase()} reported</span>
          {shelf.map((e) => {
            const first = ranking.table.columns.find((c) => c.key !== ranking.value.key && filled(e.lead.cells[c.key]) && !/ticker|symbol/i.test(c.label) && e.lead.cells[c.key] !== e.name);
            return (
              <button key={e.key} type="button" className="fd-fin-drop__chip" title={e.reports.map((r) => r.sources.map((id) => sources.get(id)).filter(Boolean).map((s) => sourceLabel(s!)).join(", ")).join("; ")}>
                <b>{initials(e)}</b>
                <span><strong>{e.name}</strong>{first ? <> · {first.label}: {e.lead.cells[first.key]}</> : null}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DropCard({ entry, ranking, sources, x, y }: { entry: RankEntry; ranking: Ranking; sources: Map<string, Source>; x: number; y: number }) {
  const others = ranking.table.columns.filter((c) => c.key !== ranking.value.key && !/ticker|symbol/i.test(`${c.key} ${c.label}`) && entry.lead.cells[c.key] !== entry.name);
  const right = x > 55;
  const quote = entry.reports.find((r) => r.evidence?.quote)?.evidence;
  return (
    <div className="fd-fin-tip" role="status" style={{ top: Math.max(0, y - 70), ...(right ? { right: `calc(${100 - x}% + ${MARK / 2 + 12}px)` } : { left: `calc(${x}% + ${MARK / 2 + 12}px)` }) }}>
      <div className="fd-fin-tip__title">{entry.name}</div>
      <div className="fd-fin-kicker" style={{ marginTop: 4 }}>
        {entry.ticker ? `${entry.ticker} · ` : ""}{entry.reports.length} {entry.reports.length === 1 ? "report" : "reports"}
      </div>
      <dl className="fd-fin-tip__rows">
        {entry.reports.map((r) => (
          <Row key={r.rowId} label={r === entry.lead ? ranking.value.label : `${ranking.value.label}, another report`}>
            <span style={{ color: "var(--fin-down)", fontWeight: 600 }}>{filled(r.text) ?? "—"}</span>
          </Row>
        ))}
        {others.map((c) => {
          const text = filled(entry.lead.cells[c.key]);
          return <Row key={c.key} label={c.label}>{text ?? <span className="text-muted-foreground">not reported</span>}</Row>;
        })}
      </dl>
      {quote ? (
        <blockquote className="fd-fin-tip__quote">
          <span className="fd-fin-kicker" style={{ display: "block", fontStyle: "normal", marginBottom: 2 }}>{sources.get(quote.source) ? sourceLabel(sources.get(quote.source)!) : "Source"}</span>
          “{quote.quote}”
        </blockquote>
      ) : null}
      <Cited ids={entry.reports.flatMap((r) => r.sources)} sources={sources} />
    </div>
  );
}
