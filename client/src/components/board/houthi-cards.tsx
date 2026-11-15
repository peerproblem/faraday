"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Link } from "@/components/ui/link";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Text } from "@/components/ui/typography";
import { evidenceUrl, SourceChips } from "@/components/widgets/source-chips";
import { hostOf } from "@/lib/source-brand";
import type { Source, TableData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";
import { useWorkspaceSizes, WorkspaceResizeHandle, type CornerWidth } from "./workspace-resize";
import "./houthi-cards.css";

type HouthiCardsProps = {
  summary: ReactNode;
  evidence: ReactNode;
  strikes?: TableData;
  sources: Map<string, Source>;
  workspaceKey?: string;
  cardWidth: CornerWidth;
};

type Column = TableData["columns"][number];
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function eventDate(value: string) {
  // Only normalize machine-readable dates. Keep dates qualified by the source, such as "around 13 Nov".
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}.*)?$/.test(value)) return null;
  const hasClock = value.includes("T");
  const iso = hasClock && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value;
  const at = toMs(iso);
  return at === null ? null : { iso, label: hasClock ? when(iso) : dayFormat.format(at) };
}

function strikeStatus(status: string): BadgeVariant {
  if (/\b(?:claim\w*|disput\w*|unconfirmed|unverified|unclear|alleg\w*)\b/i.test(status)) return "warning";
  if (/^(?:intercepted|repelled)\b/i.test(status)) return "success";
  if (/^(?:damage reported|damaged|destroyed|direct hit|confirmed strike)\b/i.test(status)) return "danger";
  return "neutral";
}

function columnNamed(columns: Column[], pattern: RegExp) {
  return columns.find(({ key, label }) => [key, label].some((field) => pattern.test(field.replace(/[-_]+/g, " ").trim())));
}

function StrikeRows({ data, sources }: { data?: TableData; sources: Map<string, Source> }) {
  if (!data?.rows.length) return <Text size="sm" tone="muted">No strike or infrastructure records yet.</Text>;
  const columns = data.columns;
  const dateColumn = columns.find(({ kind }) => kind === "time")
    ?? columnNamed(columns, /^(?:(?:event|incident|strike) )?(?:date|time|timestamp|when)\b/i);
  const placeColumn = columnNamed(columns, /^(?:(?:target|affected|strike) )?(?:location|place|site|area|region|city)\b/i);
  const statusColumn = columns.find(({ kind }) => kind === "status")
    ?? columnNamed(columns, /^(?:status|outcome|verification|result)\b/i);
  const sourceColumn = columnNamed(columns, /^(?:(?:(?:dated|reported) )?source|citation|reference|publisher)\b/i);
  const primaryColumns = new Set([dateColumn, placeColumn, statusColumn, sourceColumn]);
  const details = columns.filter((column) => !primaryColumns.has(column));
  const eventColumn = columnNamed(details, /^(?:target|event|incident|attack|description|details?|summary|strike|weapon|asset|infrastructure)\b/i)
    ?? details.find(({ kind }) => kind === "text");
  const extraColumns = details.filter((column) => column !== eventColumn);
  return (
    <ol className="fd-houthi-strike-list" aria-label="Strike and infrastructure records">
      {data.rows.map((row) => {
        const { id, evidence } = row;
        const get = (column?: Column) => column ? (row.cells[column.key] ?? "").trim() : "";
        const date = get(dateColumn);
        const time = eventDate(date);
        const place = get(placeColumn);
        const status = get(statusColumn);
        const detailedStatus = status.length > 48;
        const event = get(eventColumn);
        const citation = get(sourceColumn);
        const sourceIds = [...new Set([...(row.sources ?? []), ...(evidence ? [evidence.source] : [])])];
        const linkedSources = sourceIds.flatMap((sourceId) => {
          const source = sources.get(sourceId);
          return source && hostOf(source.url) ? [evidenceUrl(source.url)] : [];
        });
        const citationHost = hostOf(citation);
        const showCitation = citation && (!citationHost || !linkedSources.includes(evidenceUrl(citation)));
        return (
          <li className="fd-houthi-strike-row" key={id}>
            <div className="fd-houthi-strike-meta">
              {date && <Text as="span" size="sm" tone="muted" className="fd-houthi-strike-date">
                {time ? <time dateTime={time.iso}>{time.label}</time> : date}
              </Text>}
              {status && !detailedStatus && <Badge variant={strikeStatus(status)} className="fd-houthi-strike-status">{status}</Badge>}
            </div>
            {(event || place) && <Text size="sm" className="fd-houthi-strike-event">{event || place}</Text>}
            {event && place && place !== event && <Text size="sm" tone="muted">{place}</Text>}
            {detailedStatus && <Text size="sm" tone="muted">{status}</Text>}
            {extraColumns.map((column) => {
              const value = get(column);
              if (!value) return null;
              const host = column.kind === "link" ? hostOf(value) : null;
              return <Text key={column.key} size="sm" tone="muted">
                {column.label} · {host ? <Link href={value} target="_blank" rel="noreferrer">{host}</Link> : value}
              </Text>;
            })}
            {(showCitation || linkedSources.length > 0) && <div className="fd-houthi-strike-sources">
              {showCitation && <Text size="sm" tone="muted">
                {citationHost ? <Link href={citation} target="_blank" rel="noreferrer">{citationHost}</Link> : citation}
              </Text>}
              <SourceChips ids={sourceIds} sources={sources} evidence={evidence} collapseAt={4} compactLabel />
            </div>}
          </li>
        );
      })}
    </ol>
  );
}

function cardHeightBounds() {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const min = 4 * rem;
  return { min, max: Math.max(min, Math.min(35 * rem, window.innerHeight * 0.62)) };
}

function heightStyle(value: number | undefined): CSSProperties | undefined {
  return value ? { "--fd-houthi-preferred-height": `${value}px` } as CSSProperties : undefined;
}

export function HouthiCards({ summary, evidence, strikes, sources, workspaceKey, cardWidth }: HouthiCardsProps) {
  const id = useId();
  const resize = useWorkspaceSizes(workspaceKey, {});
  const briefing = resize("card:houthi-briefing");
  const log = resize("card:houthi-strikes");
  return (
    <aside className="fd-houthi-cards" aria-label="Situation and strike records">
      <Tabs defaultValue="situation" size="sm" variant="pill">
        <Card radius="lg" padding="sm" className="fd-houthi-cards-surface">
          <TabsList aria-label="Briefing views">
            <Tab value="situation" icon={<Icon name="activity" width={14} height={14} />}>Situation</Tab>
            <Tab value="evidence" icon={<Icon name="file" width={14} height={14} />}>Evidence</Tab>
          </TabsList>
          <div id={`${id}-briefing`} className="fd-houthi-resizable-content" style={heightStyle(briefing.value)}>
            <TabsPanel value="situation" className="fd-houthi-cards-scroll fd-houthi-brief-pane">
              {summary ?? <Text size="sm" tone="muted">No situation summary yet.</Text>}
            </TabsPanel>
            <TabsPanel value="evidence" className="fd-houthi-cards-scroll fd-houthi-brief-pane">
              {evidence ?? <Text size="sm" tone="muted">No evidence collected yet.</Text>}
            </TabsPanel>
          </div>
          <WorkspaceResizeHandle {...briefing} target={`${id}-briefing`} label="Resize Situation and Evidence card"
            axis="height" getBounds={cardHeightBounds} cornerWidth={cardWidth} />
        </Card>
      </Tabs>
      <Card title="Strikes & infrastructure" icon={<Icon name="layers" width={15} height={15} />} radius="lg" className="fd-houthi-cards-surface">
        <div className="fd-houthi-resizable-content" style={heightStyle(log.value)}>
          <div id={`${id}-strikes`} className="fd-houthi-cards-scroll fd-houthi-strikes-pane" tabIndex={0} role="region" aria-label="Strikes and infrastructure">
            <StrikeRows data={strikes} sources={sources} />
          </div>
        </div>
        <WorkspaceResizeHandle {...log} target={`${id}-strikes`} label="Resize Strikes and infrastructure card"
          axis="height" getBounds={cardHeightBounds} cornerWidth={cardWidth} />
      </Card>
    </aside>
  );
}
