"use client";

import { BarChart, ChartCard, DonutChart } from "@sw3/ui/charts";
import { LngLatBounds, Marker } from "maplibre-gl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/icon";
import type { PointMapInstance } from "@/components/ui/point-map";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "@/components/widgets/source-chips";
import type { MapData, Source, TableData, TimelineData } from "@/lib/spec";
import {
  buildHouthiReplay,
  formatHouthiDay,
  houthiActivity,
  houthiCategory,
  houthiMarkers,
  houthiSeries,
} from "./houthi-replay-data";
import "./houthi-replay.css";
import { useWorkspaceSizes, type CornerWidth } from "./workspace-resize";

const PointMap = dynamic(() => import("@/components/ui/point-map"), {
  ssr: false,
  loading: () => <Skeleton height="100%" radius="none" />,
});

const motionQuery = "(prefers-reduced-motion: reduce)";
const defaultCamera = { lat: 21.5, lon: 45.8, zoom: 4 };
const series = houthiSeries.map(({ key, label, color }) => ({ key, label, color }));

type MarkerReport = ReturnType<typeof houthiMarkers>[number];
type Report = MarkerReport["report"];
type ReplayDay = ReturnType<typeof buildHouthiReplay>["frames"][number];

function subscribeToMotion(listener: () => void) {
  const preference = window.matchMedia(motionQuery);
  preference.addEventListener("change", listener);
  return () => preference.removeEventListener("change", listener);
}

function houthiLocationLabel(name: string, approximate: boolean) {
  return approximate ? `${name} (approximate area)` : name;
}

function ReportDetails({ report, sources }: { report: Report; sources: Map<string, Source> }) {
  return (
    <>
      <Text size="sm" tone="muted">
        {houthiCategory(report.kind).label}
        {report.status && ` · ${report.status}`}
      </Text>
      {report.detail && <Text size="sm">{report.detail}</Text>}
      <div><SourceChips key={report.id} ids={report.sources} sources={sources} evidence={report.evidence} collapseAt={2} /></div>
    </>
  );
}

function LocationMarker({ map, marker, active, sources, onInspect }: {
  map: PointMapInstance;
  marker: MarkerReport;
  active: boolean;
  sources: Map<string, Source>;
  onInspect: (open: boolean) => void;
}) {
  const [element] = useState(() => document.createElement("div"));
  const { place, report } = marker;
  const category = houthiCategory(report.kind);
  const date = report.time === null ? null : formatHouthiDay(report.time);
  const placeLabel = houthiLocationLabel(place.name, place.approximate);
  useEffect(() => {
    const mark = new Marker({ element, anchor: "bottom" }).setLngLat([place.lon, place.lat]).addTo(map);
    return () => { mark.remove(); };
  }, [element, map, place.lat, place.lon]);

  useEffect(() => {
    element.style.zIndex = active ? "2" : "1";
  }, [element, active]);

  return createPortal(
    <Popover onOpenChange={onInspect}>
      <PopoverTrigger
        variant="secondary"
        size="sm"
        iconOnly={!active}
        className="fd-houthi-location-trigger"
        aria-label={`${placeLabel} · ${category.label}`}
        title={placeLabel}
        leading={<Icon name={category.icon} style={{ color: category.color }} />}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {active ? place.name : undefined}
      </PopoverTrigger>
      <PopoverContent padding="sm" className="fd-houthi-location-popup">
        <Text size="sm" tone="muted">
          {placeLabel}
          {date && report.at && <> · <time dateTime={report.at}>{date}</time></>}
        </Text>
        <PopoverTitle>{report.title}</PopoverTitle>
        <ReportDetails report={report} sources={sources} />
      </PopoverContent>
    </Popover>,
    element,
  );
}

function ActivityCharts({ frames, frame }: { frames: ReplayDay[]; frame: ReplayDay }) {
  const { data, breakdown, interval, total } = useMemo(() => houthiActivity(frames, frame.day), [frames, frame.day]);
  const latest = frames.at(-1)!;

  return (
    <>
      <ChartCard
        title="Reports over time"
        description={interval > 1 ? `Grouped in ${interval}-day intervals` : undefined}
        className="fd-houthi-chart"
        radius="md"
        padding="sm"
        legend={series}
      >
        <BarChart
          aria-label={`Report counts by type from ${formatHouthiDay(frames[0].day)} to ${formatHouthiDay(latest.day)}`}
          height={116}
          data={data}
          x="date"
          xFormat={(value) => formatHouthiDay(Date.parse(String(value)))}
          series={series}
          mode="stacked"
          yDomain={[0, undefined]}
          yFormat={(value) => Number.isInteger(value) ? String(value) : ""}
        />
      </ChartCard>

      <ChartCard title="Report mix" description={`Through ${formatHouthiDay(frame.day)}`} className="fd-houthi-chart" radius="md" padding="sm">
        <div className="fd-houthi-report-mix">
          <DonutChart
            aria-label={`${total} reports. ${breakdown.map(({ label, value }) => `${label}: ${value}`).join(", ")}.`}
            centralLabel={String(total)}
            centralSubLabel={total === 1 ? "Report" : "Reports"}
            height={112}
            arcWidth={13}
            data={breakdown}
          />
          <ul aria-label="Report totals by type" className="fd-houthi-report-totals">
            {breakdown.map(({ key, label, color, value }) => (
              <li key={key}>
                <Icon name={houthiCategory(key).icon} width={14} height={14} style={{ color }} />
                <span>{label}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>
    </>
  );
}

function overlayRect(slot: HTMLDivElement | null) {
  return slot && getComputedStyle(slot).position === "absolute" ? slot.getBoundingClientRect() : null;
}

export function HouthiReplay({ timeline, strikes, map: mapData, sources, timelineCard, workspaceKey, rightCards }: {
  timeline?: TimelineData;
  strikes?: TableData;
  map?: MapData;
  sources: Map<string, Source>;
  timelineCard?: ReactNode;
  workspaceKey?: string;
  rightCards: (width: CornerWidth) => ReactNode;
}) {
  const { frames, locationReports } = useMemo(() => buildHouthiReplay(timeline, strikes, mapData, sources),
    [timeline, strikes, mapData, sources]);
  const [map, setMap] = useState<PointMapInstance | null>(null);
  const [fallbackStart, setFallbackStart] = useState(false);
  const mapHost = useRef<HTMLDivElement>(null);
  const rightSlot = useRef<HTMLDivElement>(null);
  const timelineSlot = useRef<HTMLDivElement>(null);
  const chartSlot = useRef<HTMLDivElement>(null);
  const resize = useWorkspaceSizes(workspaceKey, {});
  const width = resize("details");
  const cardWidth: CornerWidth = {
    measure: () => {
      const slot = rightSlot.current;
      const box = overlayRect(slot);
      if (!slot || !box || !slot.parentElement) return null;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        size: box.width,
        bounds: { min: 17 * rem, max: Math.min(32 * rem, slot.parentElement.clientWidth * 0.36) },
      };
    },
    onResize: width.onResize,
    onCommit: width.onCommit,
  };

  const reducedMotion = useSyncExternalStore(subscribeToMotion, () => window.matchMedia(motionQuery).matches, () => false);
  // Undefined starts the first visit at the earliest day. Null stays at the newest day after replay ends.
  const [day, setDay] = useState<number | null>();
  const [inspectedPlace, setInspectedPlace] = useState<string | null>(null);
  const last = frames.length - 1;
  const nearest = day == null ? -1 : frames.findLastIndex((frame) => frame.day <= day);
  const index = day === null || reducedMotion ? last : Math.max(0, nearest);
  const current = frames[index];
  const activeReportId = current?.reports[0]?.id;
  const hasChart = Boolean(current);
  const hasTimeline = Boolean(timelineCard);
  const markers = useMemo(() => houthiMarkers(locationReports, current?.day, activeReportId, !current || index === last),
    [locationReports, current?.day, activeReportId, index, last]);

  const onLoad = useCallback((loadedMap: PointMapInstance) => {
    setMap(loadedMap);
    loadedMap.once("remove", () => {
      setMap((previous) => previous === loadedMap ? null : previous);
      setInspectedPlace(null);
    });
  }, []);

  useEffect(() => {
    const host = mapHost.current;
    if (!map || !host) return;
    const bounds = new LngLatBounds([36, 12], [58, 29]);
    let lastFit: string | undefined;
    const fit = () => {
      const left = overlayRect(timelineSlot.current);
      const right = overlayRect(rightSlot.current);
      const bottom = overlayRect(chartSlot.current);
      const viewport = map.getContainer().getBoundingClientRect();
      const padding = {
        top: 38,
        bottom: 28 + (bottom ? Math.max(0, Math.ceil(viewport.bottom - bottom.top)) : 0),
        left: 34 + (left ? Math.ceil(left.right - viewport.left) : 0),
        right: 34 + (right ? Math.ceil(viewport.right - right.left) : 0),
      };
      const fitKey = [viewport.width, viewport.height, padding.left, padding.right, padding.bottom].join(":");
      if (!viewport.width || !viewport.height || fitKey === lastFit) return;
      lastFit = fitKey;
      map.resize();
      map.fitBounds(bounds, { padding, duration: 0, maxZoom: 6 });
    };
    let raf = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    resize.observe(host);
    for (const slot of [timelineSlot.current, rightSlot.current, chartSlot.current]) {
      if (slot) resize.observe(slot);
    }
    return () => {
      resize.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [map, hasTimeline, hasChart]);

  useEffect(() => {
    if (map || fallbackStart) return;
    // Keep the report history usable even if the basemap is unavailable.
    const timer = window.setTimeout(() => setFallbackStart(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [map, fallbackStart]);

  const nextDay = frames[index + 1]?.day;
  const inspecting = markers.some(({ place }) => place.id === inspectedPlace);
  const playing = !inspecting && !reducedMotion && (map || fallbackStart) && nextDay !== undefined;
  useEffect(() => {
    if (!playing || nextDay === undefined) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      const delay = Math.max(1_050, Math.min(2_600, 25_000 / frames.length));
      timer = window.setTimeout(() => setDay(index + 1 === last ? null : nextDay), delay);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [frames.length, index, last, nextDay, playing]);

  return (
    <div className="fd-houthi-replay">
      <div className="fd-houthi-map-stage" style={width.value ? { "--fd-houthi-preferred-width": `${width.value}px` } as CSSProperties : undefined}>
        <div ref={mapHost} className="fd-houthi-map-window" aria-label="Reported locations across the Arabian Peninsula" role="region">
          <div className="fd-map-workspace">
            <PointMap points={[]} center={defaultCamera} fill fixedCamera initialStyle="theme" onLoad={onLoad} />
            {map && markers.map((marker) => (
              <LocationMarker key={marker.place.id} map={map} marker={marker} active={activeReportId === marker.report.id}
                sources={sources} onInspect={(open) => {
                  setInspectedPlace((previous) => open ? marker.place.id : previous === marker.place.id ? null : previous);
                }} />
            ))}
          </div>
        </div>
        {current && <div ref={chartSlot} className="fd-houthi-activity-charts">
          <ActivityCharts frames={frames} frame={current} />
        </div>}
        {timelineCard && <div ref={timelineSlot} className="fd-houthi-timeline-overlay">{timelineCard}</div>}
        <div ref={rightSlot} className="fd-houthi-overlay">{rightCards(cardWidth)}</div>
      </div>
    </div>
  );
}
