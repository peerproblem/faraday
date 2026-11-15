"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { AreaChart } from "@/components/ui/charts";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Meter } from "@/components/ui/meter";
import { Separator } from "@/components/ui/separator";
import { Stat } from "@/components/ui/stat";
import { Text } from "@/components/ui/typography";
import { Waterfall, type WaterfallSpan } from "@/components/ui/waterfall";
import { OfficialReleases, SourceChips } from "@/components/widgets/source-chips";
import type { HeaderData, LinkListData, Source, StatItem } from "@/lib/spec";
import { formatSpan, type Note, type WildfireView } from "./wildfire-data";

const situationLabel: Record<string, string> = {
  developing: "Developing",
  ongoing: "Ongoing",
  contained: "Contained",
  recovering: "Recovering",
  resolved: "Resolved",
};

/** The phase chart counts in thousandths of a day, so its axis steps (1, 2, 5...) land on whole days. */
const PHASE_UNIT = 86_400;
const phaseColors = { Fire: "var(--sw-chart-4)", Evacuation: "var(--sw-chart-6)", Containment: "var(--sw-chart-3)" };

function amount(item: StatItem) {
  return item.valueNum !== null && !/\d/.test(item.valueText) ? item.valueNum.toLocaleString("en-US") : item.valueText;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="fd-fire-section" aria-label={title}>
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {aside ? <Text as="span" size="sm" tone="muted">{aside}</Text> : null}
      </header>
      {children}
    </section>
  );
}

function Figure({ item, label, caption, sources }: { item: StatItem; label: string; caption?: ReactNode; sources: Map<string, Source> }) {
  return (
    <li className="grid min-w-0 content-start gap-1.5">
      <Stat size="sm" label={label} value={amount(item)} caption={caption} />
      <SourceChips ids={item.sources} sources={sources} evidence={item.evidence} collapseAt={3} compactLabel />
    </li>
  );
}

function Notes({ notes, view, sources }: { notes: Note[]; view: WildfireView; sources: Map<string, Source> }) {
  return (
    <ul className="grid gap-3">
      {notes.map((note) => (
        <li key={note.id} className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
            <Text as="span" size="sm" className="font-medium">{note.title}</Text>
            {note.ms !== null && <Text as="span" size="sm" tone="muted">{view.clock.shortDay(note.ms)}</Text>}
          </div>
          <Text size="sm" tone="muted">
            {note.text ? `${note.text} ` : null}
            <SourceChips ids={note.sources} sources={sources} evidence={note.evidence} collapseAt={3} compactLabel />
          </Text>
        </li>
      ))}
    </ul>
  );
}

/** The Details overview of a wildfire board: how the fire, the orders and containment played out, then what it cost. */
export function WildfireOverview({ view, header, sources, releases, lastChecked }: {
  view: WildfireView;
  header: HeaderData | null;
  sources: Map<string, Source>;
  releases: LinkListData["items"];
  lastChecked?: ReactNode;
}) {
  const { clock, figures, containment, growth, ignition } = view;
  const zone = ignition === null ? "" : clock.zone(ignition);
  const contained = containment.find((p) => p.v >= 100) ?? null;
  const latest = containment[containment.length - 1];
  const percent = latest?.v ?? figures.containment?.valueNum ?? null;
  const lastLift = view.releases.reduce<number | null>((max, r) => (r.ms !== null && (max === null || r.ms > max) ? r.ms : max), null);
  const peak = growth.reduce<(typeof growth)[number] | null>((best, p) => (!best || p.v > best.v ? p : best), null);
  const zoneCount = view.releases.reduce((sum, r) => sum + r.zones.length, 0);

  const phases: WaterfallSpan[] = [];
  if (ignition !== null) {
    const span = (from: number, to: number) => ({ start: Math.max(0, from - ignition) / PHASE_UNIT, duration: Math.max(60_000, to - from) / PHASE_UNIT });
    const range = (from: number, to: number) => ({ From: `${clock.moment(from)} ${zone}`, To: `${clock.moment(to)} ${zone}` });
    if (peak && peak.ms > ignition) {
      phases.push({ value: "spread", label: "Fire spread", kind: "Fire", ...span(ignition, peak.ms),
        detail: { ...range(ignition, peak.ms), Reached: `${peak.v.toLocaleString("en-US")} acres` } });
    }
    if (view.ordersIssued && lastLift !== null) {
      const issued = view.ordersIssued.ms;
      phases.push({
        value: "orders", label: "Evacuation", kind: "Evacuation", ...span(issued, lastLift), detail: range(issued, lastLift),
        children: view.releases.flatMap((release, index) => release.ms === null ? [] : [{
          value: `release:${index}`, label: release.zones.join(", "), kind: "Evacuation", ...span(issued, release.ms),
          detail: { Lifted: `${clock.moment(release.ms)} ${zone}` },
        }]),
      });
    }
    if (containment.length > 1) {
      const first = containment[0];
      const end = contained ?? latest;
      phases.push({ value: "containment", label: "Containment", kind: "Containment", ...span(first.ms, end.ms),
        detail: { ...range(first.ms, end.ms), Reached: `${end.v}%` } });
    }
  }

  const phaseEnd = phases.reduce((end, phase) => Math.max(end, phase.start + phase.duration), 0);
  // A narrow panel shows three axis labels: the start, the middle and the end of a round number of days.
  const phaseDays = [1, 2, 4, 5, 10, 20, 40, 50, 100].find((days) => days * 1000 >= phaseEnd) ?? Math.ceil(phaseEnd / 1000);
  const after = [...view.restrictions, ...view.recovery];

  return (
    <div className="fd-fire-overview">
      <section className="fd-fire-section" aria-label="Situation">
        <div className="flex flex-wrap items-center gap-1.5">
          {percent !== null && <Badge variant={percent >= 100 ? "success" : "warning"}>{percent}% contained</Badge>}
          {header?.status ? <Badge variant="outline">{situationLabel[header.status] ?? header.status}</Badge> : null}
          {lastLift !== null && <Badge variant="outline">Orders lifted</Badge>}
        </div>
        {header?.headline?.text ? (
          <Text size="sm">{header.headline.text} <SourceChips ids={header.headline.sources} sources={sources} /></Text>
        ) : header?.subtitle ? <Text size="sm" tone="muted">{header.subtitle}</Text> : null}
        {typeof header?.severity === "number" && (
          <Meter label="Severity" value={Math.min(5, Math.max(0, header.severity))} min={0} max={5}
            low={2} high={4} optimum={0} size="sm"
            formatOptions={{ style: "decimal", maximumFractionDigits: 1 }} getValueLabel={(v) => `${v} of 5`} />
        )}
        {lastChecked ? <Text size="sm" tone="muted">{lastChecked}</Text> : null}
      </section>

      {phases.length > 1 && ignition !== null && <>
        <Separator decorative />
        <Section title="How it unfolded" aside={`from ignition, ${clock.moment(ignition)} ${zone}`}>
          <Waterfall aria-label="Fire spread, evacuation orders and containment on one clock, measured from ignition"
            items={phases} kinds={phaseColors} range={[0, phaseDays * 1000]}
            format={(units) => (units <= 0 ? "0" : formatSpan(units * PHASE_UNIT))}
            nameHeader="Phase" maxTicks={2} legend={false} framed={false} className="fd-fire-phases" />
        </Section>
      </>}

      {containment.length > 1 && <>
        <Separator decorative />
        <Section title="Containment" aside={contained && ignition !== null ? `full after ${formatSpan(contained.ms - ignition)}` : undefined}>
          <AreaChart
            aria-label={`Containment rose from ${containment[0].v}% on ${clock.moment(containment[0].ms)} to ${latest.v}% on ${clock.moment(latest.ms)} ${zone}`}
            data={containment.map((p) => ({ t: new Date(p.ms), v: p.v }))}
            x={(d) => d.t}
            series={[{ key: "v", label: "Contained", color: phaseColors.Containment }]}
            curve="step"
            height={170}
            yDomain={[0, 100]}
            xFormat={(v) => clock.shortDay(+new Date(v))}
            yFormat={(v) => `${v}%`}
          />
          <Text size="sm" tone="muted">
            {containment.length} reports, {clock.shortDay(containment[0].ms)} to {clock.shortDay(latest.ms)}.{" "}
            <SourceChips ids={[...new Set(containment.flatMap((p) => p.sources))]} sources={sources} collapseAt={3} compactLabel />
          </Text>
        </Section>
      </>}

      {growth.length > 1 && peak && <>
        <Separator decorative />
        <Section title="First-day spread" aside={`${peak.v.toLocaleString("en-US")} acres in ${formatSpan(peak.ms - (ignition ?? growth[0].ms))}`}>
          <AreaChart
            aria-label={`The fire grew from ${growth[0].v} to ${peak.v} acres between ${clock.time(growth[0].ms)} and ${clock.time(peak.ms)} ${zone}`}
            data={growth.map((p) => ({ t: new Date(p.ms), v: p.v }))}
            x={(d) => d.t}
            series={[{ key: "v", label: "Acres burned", color: phaseColors.Fire }]}
            curve="linear"
            height={150}
            yDomain={[0, undefined]}
            xFormat={(v) => clock.hour(+new Date(v))}
            yFormat={(v) => v.toLocaleString("en-US")}
          />
          <Text size="sm" tone="muted">
            Acres reported on {clock.shortDay(growth[0].ms)}, {zone}.{" "}
            <SourceChips ids={[...new Set(growth.flatMap((p) => p.sources))]} sources={sources} collapseAt={3} compactLabel />
          </Text>
        </Section>
      </>}

      {(figures.evacuated || view.releases.length > 0) && <>
        <Separator decorative />
        <Section title="Evacuation" aside={zoneCount ? `${zoneCount} zones, all lifted` : undefined}>
          <ul className="fd-fire-figures">
            {figures.evacuated && <Figure item={figures.evacuated} label="Residents evacuated" caption="at the peak" sources={sources} />}
            {view.homesThreatened && (
              <li className="grid min-w-0 content-start gap-1.5">
                <Stat size="sm" label="Homes threatened" value={view.homesThreatened.text.replace(/^about\s+/i, "~").replace(/\s+at peak$/i, "")} caption="at the peak" />
                <SourceChips ids={view.homesThreatened.sources} sources={sources} evidence={view.homesThreatened.evidence} collapseAt={3} compactLabel />
              </li>
            )}
          </ul>
          {view.releases.length > 0 && (
            <ul className="grid gap-3">
              {view.releases.map((release, index) => (
                <li key={index} className="grid min-w-0 gap-1.5">
                  <Text as="span" size="sm" className="font-medium">
                    {release.ms !== null ? `Lifted ${clock.moment(release.ms)} ${zone}` : `Lifted ${release.text}`}
                  </Text>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {release.zones.map((name) => <Badge key={name} variant="outline" mono>{name}</Badge>)}
                    <SourceChips ids={release.sources} sources={sources} evidence={release.evidence} collapseAt={3} compactLabel />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </>}

      {(figures.destroyed || figures.damaged || figures.injuries) && <>
        <Separator decorative />
        <Section title="Damage and injuries">
          <ul className="fd-fire-figures">
            {figures.destroyed && <Figure item={figures.destroyed} label="Homes destroyed" sources={sources} />}
            {figures.damaged && <Figure item={figures.damaged} label="Homes damaged" sources={sources} />}
            {figures.injuries && <Figure item={figures.injuries} label="Injuries" caption={figures.injuries.delta ?? undefined} sources={sources} />}
            {figures.area && <Figure item={figures.area} label={`Area burned${figures.area.unit ? ` (${figures.area.unit})` : ""}`} sources={sources} />}
          </ul>
        </Section>
      </>}

      {after.length > 0 && <>
        <Separator decorative />
        <Section title="After the fire">
          <Notes notes={after} view={view} sources={sources} />
        </Section>
      </>}

      {releases.length > 0 && <>
        <Separator decorative />
        <Collapsible>
          <CollapsibleTrigger className="mx-0 w-full justify-between px-0">
            <span className="text-sm font-medium">Official releases <span className="text-muted-foreground">{releases.length}</span></span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-2"><OfficialReleases releases={releases} /></div>
          </CollapsiblePanel>
        </Collapsible>
      </>}
    </div>
  );
}
