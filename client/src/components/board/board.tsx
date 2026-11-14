"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from "@ui-sdk/react/accordion";
import { Button } from "@ui-sdk/react/button";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/react/meter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@ui-sdk/react/timeline";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { BoardEvent, BoardSpec, BoardStatus, Section, Source } from "@/lib/spec";
import { when } from "@/lib/time";
import { Ago } from "../ago";
import { SectionBoundary } from "./section-boundary";
import { SourceChips } from "./source-chips";

const BoardMap = dynamic(() => import("./board-map"), {
  ssr: false,
  loading: () => <div className="skeleton h-[340px]" />,
});

type Props = {
  spec: Partial<BoardSpec> | null;
  sources: Source[];
  events: BoardEvent[];
  status: BoardStatus;
  connected: boolean;
  lastPolledAt: number | null;
  onRefresh?: () => Promise<unknown>;
  compact?: boolean;
};

const defaultLayout: Section[] = [
  { type: "summary", title: "Situation", tableId: null },
  { type: "kpis", title: "Key figures", tableId: null },
  { type: "map", title: "Map", tableId: null },
  { type: "timeline", title: "Timeline", tableId: null },
  { type: "advisories", title: "Official advisories", tableId: null },
  { type: "help", title: "Get help", tableId: null },
  { type: "news", title: "Latest coverage", tableId: null },
  { type: "changes", title: "What changed", tableId: null },
  { type: "sources", title: "Sources", tableId: null },
];

const wide = new Set(["summary", "kpis", "map", "table", "changes", "sources"]);

const stageText: Record<string, string> = {
  queued: "Queued",
  planning: "Compiling the prompt into a plan",
  gathering: "Reading the live web through Context.dev",
  composing: "Writing the board",
  watching: "Setting up monitors",
};

const statusLabel: Record<string, string> = {
  developing: "Developing",
  ongoing: "Ongoing",
  contained: "Contained",
  recovering: "Recovering",
  resolved: "Resolved",
};

export function Board({ spec, sources, events, status, connected, lastPolledAt, onRefresh }: Props) {
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const building = status !== "live" && status !== "error";
  const layout = (spec?.layout?.length ? spec.layout : defaultLayout).filter(Boolean) as Section[];
  const newest = sources.reduce<string | null>((a, s) => (s.publishedAt && (!a || s.publishedAt > a) ? s.publishedAt : a), null);

  return (
    <div data-accent={spec?.accent ?? "red"} className="flex flex-col gap-4">
      <header className="rounded-xl border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
            <span className={`h-1.5 w-1.5 rounded-full bg-accent ${connected ? "pulse-dot" : ""}`} />
            {building ? "Building" : connected ? "Live" : "Offline"}
          </span>
          {spec?.status ? (
            <span className="rounded-full border border-line-strong px-2.5 py-1 text-muted">{statusLabel[spec.status]}</span>
          ) : null}
          {spec?.crisisType ? (
            <span className="rounded-full border border-line-strong px-2.5 py-1 capitalize text-muted">{spec.crisisType}</span>
          ) : null}
          <span className="ml-auto text-faint">
            {sources.length} sources read
            {newest ? (
              <>
                {" · newest "}
                <Ago t={newest} />
              </>
            ) : null}
            {lastPolledAt ? (
              <>
                {" · checked "}
                <Ago t={lastPolledAt} />
              </>
            ) : null}
          </span>
        </div>
        {spec?.title ? (
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{spec.title}</h1>
        ) : (
          <div className="skeleton mt-3 h-8 w-2/3" />
        )}
        {spec?.subtitle ? <p className="mt-1 text-sm text-muted">{spec.subtitle}</p> : null}
        {spec?.headline ? (
          <p className="mt-3 border-l-2 border-accent pl-3 text-base leading-relaxed">{spec.headline}</p>
        ) : building ? (
          <>
            <div className="skeleton mt-3 h-5 w-full" />
            <p className="mt-3 text-sm text-muted">
              <span className="pulse-dot mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
              {stageText[status] ?? "Working"}
              {status === "composing" ? ` from ${sources.length} sources. Sections appear as they are written.` : "…"}
            </p>
          </>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {typeof spec?.severity === "number" ? (
            <Meter value={spec.severity} min={0} max={5} aria-label="Severity" className="flex w-48 items-center gap-2">
              <span className="text-xs text-muted">Severity</span>
              <MeterTrack className="flex-1">
                <MeterIndicator />
              </MeterTrack>
              <span className="font-mono text-xs">{spec.severity}/5</span>
            </Meter>
          ) : null}
          {onRefresh && status === "live" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    onClick={onRefresh}
                    pendingAnnouncement="Checking the web"
                    className="ml-auto rounded-lg border border-line-strong px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-text data-pending:opacity-60"
                  />
                }
              >
                Check the web now
              </TooltipTrigger>
              <TooltipContent>Runs the monitors and news search now</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {layout.map((sec) => (
          <section
            key={sec.type === "table" ? `table-${sec.tableId}` : sec.type}
            aria-label={sec.title}
            className={`min-w-0 rounded-xl border border-line bg-panel p-4 ${wide.has(sec.type) ? "lg:col-span-2" : ""}`}
          >
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{sec.title}</h2>
            <SectionBoundary resetKey={spec}>
              <SectionBody section={sec} spec={spec} sources={sources} byId={byId} events={events} building={building} />
            </SectionBoundary>
          </section>
        ))}
      </div>
    </div>
  );
}

function Empty({ building, children }: { building: boolean; children: React.ReactNode }) {
  return building ? <div className="skeleton h-16" /> : <p className="text-sm text-faint">{children}</p>;
}

function SectionBody({
  section,
  spec,
  sources,
  byId,
  events,
  building,
}: {
  section: Section;
  spec: Partial<BoardSpec> | null;
  sources: Source[];
  byId: Map<string, Source>;
  events: BoardEvent[];
  building: boolean;
}) {
  switch (section.type) {
    case "summary":
      return spec?.summary?.text ? (
        <p className="text-[15px] leading-relaxed">
          {spec.summary.text} <SourceChips ids={spec.summary.sources} sources={byId} />
        </p>
      ) : (
        <Empty building={building}>No summary yet.</Empty>
      );
    case "kpis":
      return spec?.kpis?.length ? (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {spec.kpis.filter((k) => k && typeof k.id === "string" && typeof k.value === "string").map((k) => (
            <div key={k.id} className="min-w-0 rounded-lg border border-line bg-panel-2 p-3">
              <div
                className={`break-words font-mono font-semibold leading-tight ${k.value.length > 14 ? "text-base" : "text-xl"} ${
                  k.tone === "critical" ? "text-critical" : k.tone === "warning" ? "text-warning" : k.tone === "ok" ? "text-ok" : "text-info"
                }`}
              >
                {k.value}
                {k.unit ? <span className="ml-1 text-xs font-normal text-muted">{k.unit}</span> : null}
              </div>
              <div className="mt-1 text-xs leading-snug text-muted">{k.label}</div>
              {k.delta ? <div className="mt-1 text-[11px] text-faint">{k.delta}</div> : null}
              <div className="mt-2">
                <SourceChips ids={k.sources} sources={byId} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty building={building}>The sources did not give figures yet.</Empty>
      );
    case "map": {
      const points = (spec?.mapPoints ?? []).filter(
        (p) => p && typeof p.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !!p.kind,
      );
      const loc = spec?.location;
      const location =
        loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && Number.isFinite(loc.zoom) ? loc : null;
      if (building && spec?.mapPoints !== undefined && !spec?.tables) return <div className="skeleton h-[340px]" />;
      return points.length || location ? (
        <BoardMap points={points} location={location} />
      ) : (
        <Empty building={building}>No places to map.</Empty>
      );
    }
    case "timeline":
      return <TimelineSection spec={spec} byId={byId} building={building} />;
    case "table": {
      const table = spec?.tables?.find((t) => t?.id === section.tableId);
      if (!table?.columns?.length) return <Empty building={building}>No rows yet.</Empty>;
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="border-b border-line-strong px-2 py-2 text-left text-xs font-medium text-muted">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(table.rows ?? []).map((r, i) => (
                <tr key={`${i}-${r?.[0]}`} className="border-b border-line last:border-0">
                  {(r ?? []).map((cell, j) => (
                    <td key={j} className="px-2 py-2 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <SourceChips ids={table.sources} sources={byId} />
          </div>
        </div>
      );
    }
    case "advisories":
      return spec?.advisories?.length ? (
        <Accordion aria-label="Official advisories" defaultValue={[spec.advisories[0]?.id ?? ""]}>
          {spec.advisories.filter((a) => a && typeof a.id === "string" && a.title).map((a) => (
            <AccordionItem key={a.id} value={a.id} className="border-b border-line last:border-0">
              <AccordionHeader className="m-0">
                <AccordionTrigger className="flex items-start gap-2 py-2.5 text-sm">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      a.level === "warning" ? "bg-critical" : a.level === "watch" ? "bg-warning" : "bg-info"
                    }`}
                  />
                  <span className="min-w-0 flex-1 font-medium">{a.title}</span>
                  <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-faint sm:inline">{a.issuer}</span>
                </AccordionTrigger>
              </AccordionHeader>
              <AccordionPanel className="pb-3 pl-4 text-sm text-muted">
                <p>{a.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
                      Official notice
                    </a>
                  ) : null}
                  <SourceChips ids={a.sources} sources={byId} />
                </div>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Empty building={building}>No official advisories found in the sources.</Empty>
      );
    case "help":
      return spec?.help?.length ? (
        <ul className="grid gap-2">
          {spec.help.filter((h) => h && typeof h.id === "string" && h.url).map((h) => (
            <li key={h.id}>
              <a
                href={h.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-line bg-panel-2 p-3 hover:border-accent"
              >
                <span className="text-[10px] uppercase tracking-wider text-accent">{h.kind}</span>
                <span className="block text-sm font-medium">{h.label}</span>
                <span className="block text-xs text-muted">{h.note}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Empty building={building}>No help resources found in the sources.</Empty>
      );
    case "news": {
      const cited = citedIds(spec);
      const seenTitles = new Set<string>();
      const news = [...sources]
        .filter((s) => s.kind !== "web" && (s.kind === "monitor" || cited.has(s.id)))
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
        .filter((s) => {
          const key = (s.title ?? s.url).toLowerCase().replace(/\W+/g, " ").trim();
          return seenTitles.has(key) ? false : (seenTitles.add(key), true);
        })
        .slice(0, 12);
      return news.length ? (
        <ul className="divide-y divide-line">
          {news.map((s) => (
            <li key={s.id} className="py-2">
              <a href={s.url} target="_blank" rel="noreferrer" className="text-sm leading-snug hover:underline">
                {s.title ?? s.url}
              </a>
              <div className="mt-0.5 text-xs text-faint">
                <span className="font-mono">{s.id}</span> · {s.publisher ?? "web"} · {s.publishedAt ? <Ago t={s.publishedAt} /> : "date unknown"}
                {s.kind === "monitor" ? " · via monitor" : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty building={building}>No coverage yet.</Empty>
      );
    }
    case "changes": {
      const changes = events.filter((e) => e.kind === "update" || e.kind === "change" || e.kind === "edit");
      return changes.length ? (
        <ul className="grid gap-2">
          {changes.slice(0, 20).map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="w-20 shrink-0 font-mono text-xs text-faint">
                <Ago t={e.ts} />
              </span>
              <span className="text-[10px] uppercase tracking-wider text-accent">{e.kind}</span>
              <span className="min-w-0">{e.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">
          Nothing has changed since the board was built. The web is checked every few minutes, and a search monitor runs every
          10 minutes.
        </p>
      );
    }
    case "sources":
      return (
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            {sources.length} sources from the live web, read through Context.dev
          </summary>
          <ol className="mt-3 grid gap-1 text-xs">
            {sources.map((s) => (
              <li key={s.id} className="flex min-w-0 gap-2">
                <span className="w-8 shrink-0 font-mono text-faint">{s.id}</span>
                <span className="w-16 shrink-0 text-faint">{s.kind}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-muted hover:text-text hover:underline">
                  {s.publisher ? `${s.publisher}: ` : ""}
                  {s.title ?? s.url}
                </a>
              </li>
            ))}
          </ol>
        </details>
      );
  }
}

function citedIds(spec: Partial<BoardSpec> | null): Set<string> {
  const ids = new Set<string>();
  const add = (xs: unknown) => Array.isArray(xs) && xs.forEach((x) => typeof x === "string" && ids.add(x));
  add(spec?.summary?.sources);
  for (const group of [spec?.kpis, spec?.timeline, spec?.mapPoints, spec?.tables, spec?.advisories]) {
    for (const item of group ?? []) add((item as { sources?: unknown } | undefined)?.sources);
  }
  return ids;
}

function TimelineSection({
  spec,
  byId,
  building,
}: {
  spec: Partial<BoardSpec> | null;
  byId: Map<string, Source>;
  building: boolean;
}) {
  const [filter, setFilter] = useState<string | null>("all");
  const items = (spec?.timeline ?? []).filter((t) => t && typeof t.id === "string" && t.title).filter((t) => filter === "all" || !filter || t.importance === "high");
  if (!spec?.timeline?.length) return <Empty building={building}>No events yet.</Empty>;
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Select value={filter} onValueChange={(v) => setFilter(v as string | null)} aria-label="Timeline filter">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="high">Major events only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Timeline aria-label="Timeline of events">
        {items.map((t) => (
          <TimelineItem key={t.id} data-importance={t.importance}>
            <TimelineMarker />
            <TimelineConnector />
            <TimelineTitle className="text-sm font-medium leading-snug">{t.title}</TimelineTitle>
            <TimelineTime dateTime={t.at ?? undefined} className="mt-0.5 block font-mono text-[11px] text-faint">
              {when(t.at)}
            </TimelineTime>
            <TimelineDescription className="mt-1 text-sm text-muted">
              {t.detail} <SourceChips ids={t.sources} sources={byId} />
            </TimelineDescription>
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  );
}
