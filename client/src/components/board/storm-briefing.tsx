"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Link } from "@/components/ui/link";
import { Listbox } from "@/components/ui/listbox";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "@/components/widgets/source-chips";
import type { AlertListData, Source, TableData, TimelineData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import type { WorkspaceCard } from "./card-stack";
import { StormBriefingChart } from "./storm-briefing-chart";
import { allRegions, sortStormNotices, stormRecordTime, stormRegions, stormReplay, type StormNotice, type StormRegion } from "./storm-briefing-data";
import { StormBriefingMap } from "./storm-briefing-map";
import { BoardWorkspace } from "./workspace";

const noticePreview = 3;
const replayStepMs = 4_500;
const motionQuery = "(prefers-reduced-motion: reduce)";
const reportLabels = { impact: "Impact", alert: "Alert record", travel: "Travel" };
const cardBodyStyle: CSSProperties = {
  display: "grid", gap: "var(--sw-space-2)", minWidth: 0,
  padding: "var(--sw-space-1) var(--sw-space-3) var(--sw-space-3)", overflowWrap: "anywhere",
};
const reportRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--sw-space-2)", minWidth: 0,
};
function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function ReportDate({ value }: { value: string | null }) {
  if (toMs(value) === null || !value) return null;
  const display = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value))
    : when(value);
  return <time dateTime={value}>{display}</time>;
}

function NoticeBadge({ notice }: { notice: StormNotice }) {
  if (!notice.active) return <Badge variant="outline">Ended</Badge>;
  const labels = { warning: "Warning", watch: "Watch", info: "Advisory" };
  return <Badge variant={notice.level === "warning" ? "warning" : "neutral"}>{labels[notice.level]}</Badge>;
}

function RegionalBrief({ region, sources }: { region: StormRegion; sources: Map<string, Source> }) {
  const impact = region.impacts.find(({ cells }) => cells["key-impacts"]);
  const travel = region.travel[0];
  const impactText = region.spotlight?.title ?? impact?.cells["key-impacts"];
  const impactSource = region.spotlight ?? impact;
  return (
    <dl className="grid gap-2 border-t border-hairline pt-2 text-sm">
      {impactText && impactSource && <div>
        <dt className="text-muted-foreground">Impact</dt>
        <dd>{impactText} <SourceChips ids={impactSource.sources} sources={sources} evidence={impactSource.evidence} collapseAt={2} /></dd>
      </div>}
      {travel && <div>
        <dt className="text-muted-foreground">Travel</dt>
        <dd>{travel.cells.facility} · {travel.cells.details || travel.cells.status}{" "}
          <SourceChips ids={travel.sources} sources={sources} evidence={travel.evidence} collapseAt={2} />
        </dd>
      </div>}
    </dl>
  );
}

function NoticeList({ notices, atSnapshot, sources }: {
  notices: StormNotice[];
  atSnapshot: boolean;
  sources: Map<string, Source>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? notices : notices.slice(0, noticePreview);
  if (!notices.length) return <Text size="sm" tone="muted">
    {atSnapshot ? "No notices in the snapshot for this region." : "No dated notices for this time and region."}
  </Text>;
  return (
    <>
      <Accordion aria-label="Recorded notices" variant="plain">
        {visible.map((notice) => (
          <AccordionItem key={notice.id} value={notice.id}>
            <AccordionTrigger meta={<NoticeBadge notice={notice} />} style={{ textAlign: "start", paddingBlock: "var(--sw-space-2)" }}>
              <span style={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>{notice.title}</span>
            </AccordionTrigger>
            <AccordionPanel>
              <div className="grid min-w-0 gap-2">
                {(notice.issuer || notice.asOf) && <Text size="sm" tone="muted" as="div" className="flex flex-wrap gap-x-3">
                  {notice.issuer && <span>{notice.issuer}</span>}
                  <ReportDate value={notice.asOf} />
                </Text>}
                <Text size="sm">{notice.text}</Text>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceChips ids={notice.sources} sources={sources} evidence={notice.evidence} />
                  {notice.url && /^https?:\/\//i.test(notice.url) && <Link href={notice.url} target="_blank" rel="noreferrer">Official notice</Link>}
                </div>
              </div>
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
      {notices.length > noticePreview && <Button size="sm" variant="secondary" style={{ justifySelf: "start" }}
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Show fewer notices" : `Show all ${notices.length} notices`}
      </Button>}
    </>
  );
}

type StormWorkspace = Pick<ComponentProps<typeof BoardWorkspace>, "workspaceKey" | "sidebar" | "configuredCards" |
  "defaultEvidenceOpen" | "showSavedSources" | "sources" | "sourceCount" | "changes" | "contextEvidence">;

export function StormBriefing({ snapshotAt, alerts, impacts, travel, timeline, headline, sources, header, workspace }: {
  snapshotAt: number;
  alerts?: AlertListData;
  impacts?: TableData;
  travel?: TableData;
  timeline?: TimelineData;
  headline?: { text: string; sources: string[] } | null;
  sources: Map<string, Source>;
  header: ReactNode;
  workspace: StormWorkspace;
}) {
  const [regionId, setRegionId] = useState(allRegions.id);
  const [cursor, setCursor] = useState(0);
  const workspaceRoot = useRef<HTMLDivElement>(null);
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const notices = useMemo(() => sortStormNotices(alerts?.items ?? []), [alerts]);
  const regions = useMemo(() => stormRegions({
    impacts: impacts?.rows ?? [], travel: travel?.rows ?? [], notices, timeline: timeline?.items ?? [],
  }), [impacts, travel, notices, timeline]);
  const frames = useMemo(() => stormReplay({
    timeline: timeline?.items ?? [], notices, travel: travel?.rows ?? [], snapshotAt,
  }), [notices, timeline, travel, snapshotAt]);
  const lastIndex = frames.length - 1;
  const currentIndex = reducedMotion ? lastIndex : Math.min(cursor, lastIndex);
  const frame = frames[currentIndex];
  const atSnapshot = currentIndex === lastIndex;
  const report = frame.reports[0];
  const highlightedIds = report?.regionIds;
  const selected = regions.find(({ id }) => id === regionId);
  const replayRegion = highlightedIds?.length === 1 ? regions.find(({ id }) => id === highlightedIds[0]) : undefined;
  const noticeRegion = selected ?? replayRegion;
  const scopedNotices = noticeRegion?.notices ?? notices;
  const visibleNotices = atSnapshot ? scopedNotices : scopedNotices.filter(({ asOf }) => {
    const time = stormRecordTime(asOf);
    return time !== null && time <= frame.time;
  });
  const featured = visibleNotices.find(({ id }) => id === report?.noticeId);
  const orderedNotices = featured ? [featured, ...visibleNotices.filter(({ id }) => id !== featured.id)] : visibleNotices;

  useEffect(() => {
    if (reducedMotion || frames.length < 2) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        if (document.hidden) return;
        if (workspaceRoot.current?.querySelector("[data-storm-reading]:is(:hover, :focus-within)")) {
          schedule();
          return;
        }
        setCursor((currentIndex + 1) % frames.length);
      }, atSnapshot ? replayStepMs * 2 : replayStepMs);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [atSnapshot, currentIndex, frames.length, reducedMotion]);

  function selectRegion(id: string | null) {
    setRegionId((current) => id && id !== current ? id : allRegions.id);
  }

  const configured = workspace.configuredCards ?? [];
  const cancellations = configured.find(({ id }) => id === "card:reporting");
  const cards: WorkspaceCard[] = [
    {
      id: "card:regions",
      label: "Regions",
      open: true,
      content: <div style={cardBodyStyle}>
        <Listbox aria-label="Regions on the map" framed={false} activation="manual" deselectable
          value={selected?.id ?? null} onValueChange={selectRegion} emptyMessage="No regional reports in this snapshot."
          items={regions.map((region) => {
            const inReplay = highlightedIds?.includes(region.id);
            return {
              value: region.id,
              label: region.label,
              icon: <Icon name={inReplay ? "activity" : "dot"} className={inReplay ? "text-warning" : "text-muted-foreground"} />,
            };
          })} />
        {selected && <RegionalBrief region={selected} sources={sources} />}
      </div>,
    },
    ...(cancellations ? [{
      ...cancellations,
      content: <div style={cardBodyStyle}>
        <StormBriefingChart travel={travel} sources={sources} onSelectAirport={selectRegion} fallback={cancellations.content} />
      </div>,
    }] : []),
    {
      id: "card:alerts",
      label: "Recorded warnings",
      open: true,
      content: <div style={cardBodyStyle} data-storm-reading="">
        <Text size="sm" tone="muted">
          {noticeRegion?.label ?? "All regions"}
        </Text>
        <NoticeList key={selected?.id ?? allRegions.id} notices={orderedNotices} atSnapshot={atSnapshot} sources={sources} />
      </div>,
    },
    ...configured.filter(({ id }) => id !== "card:reporting"),
  ];

  return (
    <div ref={workspaceRoot} className="fd-workspace-board" style={{ containerType: "inline-size" }}>
      {header}
      <BoardWorkspace {...workspace} cardsOnMap flowingDetails configuredCards={cards} overview={null} sections={[]}
        map={<StormBriefingMap regions={regions} selectedId={selected?.id ?? allRegions.id}
          highlightedIds={highlightedIds} highlightedReport={report?.title} onSelect={selectRegion} />}
        mapFooter={
          <div data-storm-reading="" aria-label="Recorded storm event" style={{
            display: "grid", gap: "var(--sw-space-1)", minWidth: 0, padding: "var(--sw-space-2) var(--sw-space-4)",
            borderBlockStart: "1px solid var(--sw-hairline)", background: "var(--sw-background)",
          }}>
            <div style={reportRowStyle}>
              <Text as="span" size="sm" tone="muted"><ReportDate value={frame.at} /></Text>
              {report && <Badge variant="outline">{reportLabels[report.kind]}</Badge>}
            </div>
            <div style={reportRowStyle}>
              <Text size="sm" className="min-w-0 font-medium">{report?.title ?? headline?.text ?? "Storm snapshot"}</Text>
              {report
                ? <SourceChips ids={report.sources} sources={sources} evidence={report.evidence} collapseAt={2} />
                : headline && <SourceChips ids={headline.sources} sources={sources} collapseAt={2} />}
            </div>
          </div>
        }
      />
    </div>
  );
}
