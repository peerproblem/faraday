"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { isBuilding } from "@/components/board/board";
import { LogoMark } from "@/components/logo";
import { WorkspaceNavigation } from "@/components/site-header";
import { SourceStack } from "@/components/sources/source-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/ui/charts";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Meter } from "@/components/ui/meter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import { Heading } from "@/components/ui/typography";
import { AsOf } from "@/components/widgets/as-of";
import { ChangelogWidget } from "@/components/widgets/changelog";
import { NarrativeWidget } from "@/components/widgets/narrative";
import { widgetComponent } from "@/components/widgets/registry";
import { SourceChips } from "@/components/widgets/source-chips";
import { SourcesWidget } from "@/components/widgets/sources";
import { TimelineWidget } from "@/components/widgets/timeline";
import type { WidgetProps } from "@/components/widgets/types";
import type { MarketData } from "@/lib/market";
import { SITE_URL } from "@/lib/config";
import { outletsOf } from "@/lib/source-brand";
import type { BoardData, BoardSpecV2, BoardView, StatItem, Widget } from "@/lib/spec";
import { newest } from "@/lib/time";
import { CoverageFeed } from "./coverage-feed";
import { DropChart } from "./drop-chart";
import { activeAlerts, figures, inScale, keyEventLane, metricSeries, ofType, placedWidgets, ranking, tableLanes, type Placed } from "./finance-data";
import { MarketsPanel, useMarketView } from "./markets-panel";

const cadence: Record<string, string> = { hot: "Checked every 2 minutes", warm: "Checked every 5 minutes", cold: "Checked every 30 minutes", paused: "Updates paused" };
/** Widget types this page draws in its own way. Anything else falls back to the shared widget. */
const OWN = new Set(["narrative", "stat-grid", "trend", "timeline", "alert-list", "feed", "changelog", "sources", "link-list"]);

/** A finance board as a market desk: figures tape, prices with the news pinned on, companies by fall, the coverage wall. */
export function FinanceBoard({ board, spec, data, connected, onRefresh, actions, market }: {
  board: BoardView;
  spec: BoardSpecV2 | null;
  data: BoardData | null;
  connected: boolean;
  onRefresh?: () => Promise<void>;
  actions?: ReactNode;
  market: MarketData | null;
}) {
  const sources = board.sources;
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const placed = useMemo(() => placedWidgets(spec, data), [spec, data]);
  const series = useMemo(() => metricSeries(placed), [placed]);
  const lanes = useMemo(() => [...tableLanes(placed), ...[keyEventLane(placed)].filter((l) => l !== null)], [placed]);
  const rank = useMemo(() => ranking(placed), [placed]);
  const stats = useMemo(() => figures(placed), [placed]);
  const alerts = activeAlerts(placed);
  const header = data?.header ?? null;
  const building = isBuilding(board.status);
  const live = connected && board.status === "live" && board.tier !== "paused";

  const view = useMarketView({ market, series, lanes });

  const props = (p: Placed): WidgetProps => ({
    widget: p.widget, data: p.data as never, sources: byId, allSources: sources, events: board.events,
    status: board.status, tier: board.tier, building,
  });
  const first = (type: Widget["type"]) => ofType(placed, type)[0];
  const narrative = first("narrative");
  const timeline = first("timeline");
  const feed = first("feed");
  const changelog = first("changelog");
  const sourcesWidget = first("sources");
  const laneTables = new Set(lanes.map((l) => l.key));
  // The engine adds a map to every board with a place; a finance board's story is in its markets, so it is left out.
  const rest = placed.filter((p) => !OWN.has(p.widget.type) && p.widget.type !== "map" && !laneTables.has(p.widget.id) && p.widget.id !== rank?.widget.id && widgetComponent(p.widget.type));
  const outlets = useMemo(() => outletsOf(sources), [sources]);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (e) {
      toast.danger("Could not check the web", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="fd-fin">
      {/* The same slim header as the workspace boards, in place of the site header. */}
      <header className="fd-workspace-header fd-fin__topbar flex min-w-0 shrink-0 items-center gap-2 border-b border-hairline">
        <Button href={`${SITE_URL}/`} variant="ghost" size="sm" iconOnly aria-label="Faraday home"
          className="shrink-0" leading={<LogoMark className="h-5 w-5" />} />
        <Heading as="h2" size="sm" className="fd-workspace-title min-w-0 flex-1 truncate" title={header?.title ?? board.title ?? undefined}>
          {header?.title ?? board.title ?? "Live board"}
        </Heading>
        <WorkspaceNavigation />
      </header>
      <div className="fd-fin__strip fd-fin-kicker">
        <Badge variant={building ? "accent" : live ? "success" : "neutral"} pulse={live || building}>{building ? "Building" : live ? "Live" : connected ? "Paused" : "Offline"}</Badge>
        {header?.status ? <span>{header.status}</span> : null}
        <span>{cadence[board.tier] ?? ""}</span>
        {board.lastPolledAt ? <span>Checked <Ago t={board.lastPolledAt} /></span> : null}
        <span className="fd-fin__strip-end">
          {newest(sources.map((s) => s.publishedAt)) ? <span>Newest source <Ago t={newest(sources.map((s) => s.publishedAt))} /></span> : null}
        </span>
      </div>

      <header className="fd-fin__mast">
        <div>
          <div className="fd-fin-kicker">Markets · live board</div>
          <h1 className="fd-fin__title" style={{ marginTop: 10 }}>{header?.title ?? board.title ?? "Live board"}</h1>
          {header?.headline ? (
            <p className="fd-fin__dek">{header.headline.text} <SourceChips ids={header.headline.sources} sources={byId} /></p>
          ) : header?.subtitle ? <p className="fd-fin__dek">{header.subtitle}</p> : null}
          {header?.headline && header.subtitle ? <p className="fd-fin-note" style={{ marginTop: 16 }}>{header.subtitle}</p> : null}
          {alerts.map((a) => (
            <div key={a.id} className="fd-fin__alert" role="note">
              <Badge variant={a.level === "warning" ? "warning" : "neutral"}>{a.level}</Badge>
              <div style={{ minWidth: 0, fontSize: 14, lineHeight: 1.45 }}>
                <strong>{a.issuer}</strong> · {a.title} {a.asOf ? <span className="text-muted-foreground">· <Ago t={a.asOf} /></span> : null}{" "}
                <SourceChips ids={a.sources} sources={byId} evidence={a.evidence} />
              </div>
            </div>
          ))}
        </div>
        <aside className="fd-fin__mast-side" aria-label="Board status">
          {typeof header?.severity === "number" ? (
            <Meter label="Severity" value={Math.min(5, Math.max(0, header.severity))} min={0} max={5} low={2} high={4} optimum={0} size="sm"
              formatOptions={{ style: "decimal", maximumFractionDigits: 1 }} getValueLabel={(v) => `${v} of 5`} />
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SourceStack outlets={outlets} max={5} />
            <span style={{ fontSize: 13 }} className="text-muted-foreground">{sources.length} sources · {outlets.length} outlets</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {actions}
            {onRefresh && board.status === "live" && board.tier !== "paused" ? (
              <Button variant="outline" size="sm" loading={refreshing} onClick={() => void refresh()}>Check the web now</Button>
            ) : null}
          </div>
        </aside>
      </header>

      {stats.length ? (
        <section className="fd-fin__tape" aria-label={first("stat-grid")?.widget.title ?? "Key figures"}>
          {stats.map((s) => <Tick key={s.key} stat={s} tier={board.tier} color={view.colorOf(s)} chartable={view.lineOf(s) !== null}
            on={view.isShown(s)} onFocus={() => view.focus(s)} />)}
        </section>
      ) : null}

      <div className="fd-fin__grid">
        {view.priced || series.length || lanes.length ? (
          <section id="fd-fin-markets" className="fd-fin__panel fd-fin__panel--main" aria-labelledby="fd-fin-markets-h">
            <MarketsPanel view={view} sources={byId} />
          </section>
        ) : null}

        {timeline ? (
          <aside className="fd-fin__panel fd-fin__panel--side" aria-labelledby="fd-fin-story-h">
            <div className="fd-fin__head"><div><div className="fd-fin-kicker">Timeline</div><h2 id="fd-fin-story-h" className="fd-fin__h2">{timeline.widget.title}</h2></div></div>
            {/* Every finance board tells its timeline as a story, as the sell-off board does. */}
            <TimelineWidget {...(props({ ...timeline, widget: { ...timeline.widget, display: "story" } }) as WidgetProps<"timeline">)} />
          </aside>
        ) : null}

        {rank ? (
          <section className="fd-fin__panel fd-fin__panel--main" aria-labelledby="fd-fin-rank-h">
            <div className="fd-fin__head">
              <div><div className="fd-fin-kicker">Companies</div><h2 id="fd-fin-rank-h" className="fd-fin__h2">{rank.widget.title}</h2></div>
              <span className="fd-fin-note">Height = {rank.value.label}, as reported. Hover a company for details.</span>
            </div>
            <DropChart ranking={rank} sources={byId} />
          </section>
        ) : null}

        {/* Without a company chart the briefing leads its row, and the coverage fills the rest of it. */}
        <aside className={`fd-fin__panel fd-fin__panel--side${rank ? "" : " fd-fin__panel--lead"}`} aria-label="Briefing">
          {narrative ? (
            <>
              <div className="fd-fin__head"><div><div className="fd-fin-kicker">Briefing</div><h2 className="fd-fin__h2">{narrative.widget.title}</h2></div></div>
              <NarrativeWidget {...(props(narrative) as WidgetProps<"narrative">)} collapseSourceGroups />
            </>
          ) : null}
        </aside>

        <section className={`fd-fin__panel ${rank ? "fd-fin__panel--full" : "fd-fin__panel--wide"}`} aria-labelledby="fd-fin-feed-h">
          <CoverageFeed sources={sources} title={feed?.widget.title ?? "Latest coverage"} />
        </section>

        {rest.map((p) => {
          const Comp = widgetComponent(p.widget.type)!;
          return (
            <section key={p.widget.id} className="fd-fin__panel fd-fin__panel--full" aria-label={p.widget.title}>
              <div className="fd-fin__head"><h2 className="fd-fin__h2">{p.widget.title}</h2></div>
              <Comp {...props(p)} />
            </section>
          );
        })}
      </div>

      <footer className="fd-fin__foot">
        {sourcesWidget ? (
          <section aria-labelledby="fd-fin-sources-h">
            <Collapsible>
              <div className="fd-fin__head" style={{ marginBottom: 0 }}>
                <div>
                  <div className="fd-fin-kicker">Sources</div>
                  <h2 id="fd-fin-sources-h" className="fd-fin__h2">{sources.length} sources from {outlets.length} outlets</h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <SourceStack outlets={outlets} max={8} />
                  <CollapsibleTrigger>Show all</CollapsibleTrigger>
                </div>
              </div>
              <CollapsiblePanel>
                <div style={{ marginTop: 16 }}><SourcesWidget {...(props(sourcesWidget) as WidgetProps<"sources">)} /></div>
              </CollapsiblePanel>
            </Collapsible>
          </section>
        ) : <div />}
        {changelog ? (
          <section aria-labelledby="fd-fin-log-h">
            <div className="fd-fin__head"><div><div className="fd-fin-kicker">Activity</div><h2 id="fd-fin-log-h" className="fd-fin__h2">{changelog.widget.title}</h2></div></div>
            <ScrollArea style={{ maxHeight: 280 }}>
              <ChangelogWidget {...(props(changelog) as WidgetProps<"changelog">)} />
            </ScrollArea>
          </section>
        ) : <div />}
      </footer>
    </div>
  );
}

/** One figure in the tape: latest value, change, freshness and a sparkline. Opens its series on the chart. */
function Tick({ stat, tier, color, chartable, on, onFocus }: { stat: StatItem; tier: string; color: string; chartable: boolean; on: boolean; onFocus: () => void }) {
  const dir = stat.deltaNum === null || stat.deltaNum === 0 ? "flat" : stat.deltaNum > 0 ? "up" : "down";
  const unit = stat.unit && !/[a-z%$€£¥]/i.test(stat.valueText) ? stat.unit : null;
  const body = (
    <>
      <span className="fd-fin-kicker">{stat.label}</span>
      <span className="fd-fin__tick-value">{stat.valueText}{unit ? <span className="fd-fin__tick-unit">{unit}</span> : null}</span>
      {stat.delta ? <span className="fd-fin__delta" data-dir={dir}>{dir === "up" ? "▲" : dir === "down" ? "▼" : "•"} {stat.delta}</span> : null}
      {stat.history.length > 1 ? <Sparkline data={inScale(stat.history).map((h) => h.v)} height={26} color={color} /> : null}
      <span style={{ fontSize: 11 }} className="text-muted-foreground"><AsOf t={stat.asOf} tier={tier} /></span>
    </>
  );
  return chartable ? (
    <button type="button" className="fd-fin__tick" data-chartable="" data-on={on ? "" : undefined} style={{ ["--tick-color" as string]: color }}
      aria-pressed={on} aria-label={`${stat.label}: ${stat.valueText}. Show on the chart`} onClick={onFocus}>
      {body}
    </button>
  ) : (
    <div className="fd-fin__tick">{body}</div>
  );
}
