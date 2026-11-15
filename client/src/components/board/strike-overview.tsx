"use client";

import type { ReactNode } from "react";
import { useCurrentTime } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BarList, TrendChart } from "@/components/ui/charts";
import { DashboardSection } from "@/components/ui/dashboard";
import { Stat } from "@/components/ui/stat";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "@/components/widgets/source-chips";
import type { BoardData, Source, TimelineData, Widget } from "@/lib/spec";
import { toMs } from "@/lib/time";
import {
  cityMarches, serviceLevels, steadyHistory, strikeActors, strikeDay, strikeFigures, strikeStats, turnoutClaims,
  turnoutSentence, upcomingVote, type Actor, type Stance,
} from "./strike-data";
import "./strike.css";

type Props = { widgets: Widget[]; data: BoardData | null; sources: Map<string, Source> };

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const percentOf = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

type FigureKind = "march" | "transport" | "policing";
const kindOf = (key: string): FigureKind => /cancel/.test(key) ? "transport" : /arrest|detain/.test(key) ? "policing" : "march";
// Each kind keeps one colour across the map cards and the Details sections (see strike.css).

/** The counts of the day over the map: marchers, cancellations and arrests. */
export function StrikeMapFigures({ widgets, data }: Omit<Props, "sources">) {
  const figures = strikeFigures(strikeStats(widgets, data));
  if (!figures.length) return null;
  return (
    <div className="fd-strike-figures">
      <ul aria-label="Strike figures">
        {figures.map((figure) => (
          <li key={figure.key}>
            <Card padding="none" radius="md" bordered={false} className="fd-strike-figure" data-kind={kindOf(figure.key)}>
              <Stat size="sm" label={figure.label} value={figure.value} />
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** When the reports of the strike day came in, hour by hour, above the timeline. */
export function StrikeDayChart({ timeline }: { timeline: TimelineData | undefined }) {
  const day = strikeDay(timeline);
  if (!day) return null;
  const first = day.hours.findIndex((hour) => hour.count > 0);
  const hours = day.hours.slice(Math.max(0, first - 1));
  const peak = hours.reduce((best, hour) => hour.count > best.count ? hour : best, hours[0]);
  const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const total = hours.reduce((sum, hour) => sum + hour.count, 0);
  return (
    <figure className="fd-strike-day">
      <figcaption className="flex items-baseline justify-between gap-2">
        <Text as="span" size="sm" className="font-medium">Strike day by the hour</Text>
        <Text as="span" size="sm" tone="muted">{dayMonth.format(new Date(`${day.day}T00:00:00Z`))}, UTC</Text>
      </figcaption>
      <TrendChart variant="bars" height={104} values={hours.map((hour) => hour.count)}
        labels={hours.map((hour) => clock(hour.hour))} seriesLabels={["Reported events", "Previous"]}
        format={(value) => String(Math.round(value))}
        aria-label={`${total} timed events on the strike day. Most were reported around ${clock(peak.hour)} UTC.`} />
      <Text size="sm" tone="muted">{total} timed reports. Most came in around {clock(peak.hour)}.</Text>
    </figure>
  );
}

function Actors({ title, stance, actors, sources }: { title: string; stance: Stance; actors: Actor[]; sources: Map<string, Source> }) {
  const side = actors.filter((actor) => actor.stance === stance);
  if (!side.length) return null;
  return (
    <section className="grid min-w-0 content-start gap-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="fd-strike-dot" data-side={stance} />
        <h4 className="text-sm font-medium">{title}</h4>
        <Text as="span" size="sm" tone="muted" className="tabular-nums">{side.length}</Text>
      </div>
      <ul className="fd-strike-rows">
        {side.map((actor) => (
          <li key={actor.id}>
            <Text size="sm" className="font-medium">{actor.name}</Text>
            <Text size="sm" tone="muted">{actor.position} <SourceChips ids={actor.sources.slice(0, 1)} sources={sources} evidence={actor.evidence} /></Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Overview tab of the general strike board. `summary` is the board's own headline, check time and severity. */
export function StrikeOverview({ widgets, data, sources, summary, status }: Props & { summary: ReactNode; status?: string | null }) {
  const stats = strikeStats(widgets, data);
  const figures = strikeFigures(stats);
  const claims = turnoutClaims(widgets, data);
  const dispute = turnoutSentence(widgets, data);
  const cities = cityMarches(widgets, data);
  const services = serviceLevels(widgets, data);
  const actors = strikeActors(widgets, data);
  const vote = upcomingVote(widgets, data);
  const timeline = widgets.flatMap((widget) => widget.type === "timeline" ? [data?.widgets[widget.id] as TimelineData | undefined] : [])[0];
  const day = strikeDay(timeline)?.day;
  const transport = figures.filter((figure) => /cancel/.test(figure.key));
  const arrests = figures.find((figure) => /arrest|detain/.test(figure.key));
  const arrestHistory = arrests ? steadyHistory(arrests.item.history) : [];
  const voteAt = vote ? toMs(vote.date) : null;
  const now = useCurrentTime();
  const daysLeft = voteAt === null || now === null ? null : Math.ceil((voteAt - now) / 86_400_000);

  return (
    <div className="fd-strike-overview">
      <div className="grid gap-3">
        {(status || day) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {status && <Badge variant={/recover|resolved|contained/i.test(status) ? "success" : "warning"}>{status}</Badge>}
            {day && <Badge variant="outline">24-hour strike, {dayMonth.format(new Date(`${day}T00:00:00Z`))}</Badge>}
          </div>
        )}
        {summary}
      </div>

      {claims && (
        <DashboardSection title="Turnout is disputed" headingLevel={3} defaultOpen>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="fd-strike-claim" data-side="for">
                <Stat size="sm" label="Unions say" value={`${claims.unions.bound === "up to" ? "Up to " : ""}${percentOf(claims.unions.value)}`}
                  caption="in their strongest sector" />
                <SourceChips ids={claims.unions.sources.slice(0, 2)} sources={sources} evidence={claims.unions.evidence} />
              </div>
              <div className="fd-strike-claim" data-side="against">
                <Stat size="sm" label="Employers say" value={`Under ${percentOf(claims.employers.value)}`} caption="on average, nationwide" />
                <SourceChips ids={claims.employers.sources.slice(0, 2)} sources={sources} evidence={claims.employers.evidence} />
              </div>
            </div>
            {dispute && <Text size="sm" tone="muted">{dispute.text} <SourceChips ids={dispute.sources} sources={sources} /></Text>}
          </div>
        </DashboardSection>
      )}

      {cities.length > 0 && (
        <DashboardSection title="Marches by city" count={`${cities.length} reported`} headingLevel={3} defaultOpen>
          <ul className="fd-strike-rows">
            {cities.map((march) => (
              <li key={march.id} className="fd-strike-city">
                <div className="min-w-0">
                  <Text size="sm" className="font-medium">{march.city}</Text>
                  <Text size="sm" tone="muted">
                    {march.attendance ? `${march.attendance} marched` : "No march held"}{" "}
                    <SourceChips ids={march.sources.slice(0, 1)} sources={sources} evidence={march.evidence} />
                  </Text>
                </div>
                <Badge variant={march.tone === "neutral" ? "success" : march.tone} className="h-auto min-h-5 max-w-[11rem] whitespace-normal py-0.5 text-right leading-snug">{march.status}</Badge>
              </li>
            ))}
          </ul>
        </DashboardSection>
      )}

      {(transport.length > 0 || services.length > 0) && (
        <DashboardSection title="Transport" headingLevel={3} defaultOpen>
          <div className="fd-strike-transport grid gap-4">
            {transport.length > 0 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {transport.map((figure) => {
                  const history = steadyHistory(figure.item.history);
                  return (
                    <div key={figure.key} className="grid min-w-0 content-between gap-1.5" data-kind="transport">
                      <Stat size="sm" label={figure.label} value={figure.value}>
                        {history.length > 2 && <TrendChart spark color="var(--sw-chart-7)" values={history} aria-label={`${figure.label} over ${history.length} reports`} />}
                      </Stat>
                      <SourceChips ids={figure.item.sources.slice(0, 2)} sources={sources} evidence={figure.item.evidence} />
                    </div>
                  );
                })}
              </div>
            )}
            {services.length > 1 && (
              <figure className="grid gap-2">
                <figcaption><Text as="span" size="sm" tone="muted">Share of normal service that ran, by line</Text></figcaption>
                <BarList items={services} max={100} format={percentOf} aria-label="Share of normal service that ran on strike day, by transport line" />
              </figure>
            )}
          </div>
        </DashboardSection>
      )}

      {arrests && (
        <DashboardSection title="Policing" headingLevel={3} defaultOpen>
          <div className="grid grid-cols-2 items-end gap-x-4" data-kind="policing">
            <div className="grid min-w-0 gap-1.5">
              <Stat size="sm" label="Arrests nationwide" value={arrests.value} caption={arrests.item.delta ?? undefined} />
              <SourceChips ids={arrests.item.sources.slice(0, 2)} sources={sources} evidence={arrests.item.evidence} />
            </div>
            {arrestHistory.length > 2 && (
              <TrendChart spark height={56} color="var(--sw-danger)" values={arrestHistory} aria-label={`Arrests over ${arrestHistory.length} reports`} />
            )}
          </div>
        </DashboardSection>
      )}

      {actors.length > 0 && (
        <DashboardSection title="Where the sides stand" count={`${actors.length} actors`} headingLevel={3} defaultOpen>
          <div className="grid gap-4">
            <Actors title="Backing the strike" stance="for" actors={actors} sources={sources} />
            <Actors title="Against it" stance="against" actors={actors} sources={sources} />
          </div>
        </DashboardSection>
      )}

      {vote && voteAt !== null && (
        <DashboardSection title="What comes next" headingLevel={3} defaultOpen>
          <div className="grid gap-1.5">
            <Stat size="sm" label="Snap election" value={dayMonth.format(voteAt)}
              delta={daysLeft === null ? undefined : daysLeft > 1 ? `in ${daysLeft} days` : daysLeft === 1 ? "tomorrow" : daysLeft === 0 ? "today" : "held"} trend="flat" />
            <Text size="sm" tone="muted">{vote.detail} <SourceChips ids={vote.sources.slice(0, 2)} sources={sources} evidence={vote.evidence} /></Text>
          </div>
        </DashboardSection>
      )}
    </div>
  );
}
