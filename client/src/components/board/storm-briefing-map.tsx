"use client";

import dynamic from "next/dynamic";
import { LngLatBounds, Marker } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { PointMapInstance } from "@/components/ui/point-map";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { allRegions, type StormRegion } from "./storm-briefing-data";

const PointMap = dynamic(() => import("@/components/ui/point-map"), {
  ssr: false,
  loading: () => <Skeleton height="100%" radius="none" />,
});

const markerAnchors: Record<string, "left" | "right" | "bottom"> = {
  azores: "left",
  portugal: "right",
  spain: "left",
  france: "bottom",
  italy: "right",
};

function RegionMarker({ map, region, selected, highlighted, report, showReport, onSelect }: {
  map: PointMapInstance;
  region: StormRegion;
  selected: boolean;
  highlighted: boolean;
  report?: string;
  showReport: boolean;
  onSelect: (id: string) => void;
}) {
  const [element] = useState(() => document.createElement("div"));
  const { id, label, lat, lon, spotlight, impacts, notices, travel } = region;
  const anchor = markerAnchors[id] ?? "center";

  useEffect(() => {
    const marker = new Marker({ element, anchor }).setLngLat([lon, lat]).addTo(map);
    return () => { marker.remove(); };
  }, [anchor, element, lat, lon, map]);

  useEffect(() => {
    element.style.zIndex = showReport ? "4" : selected ? "3" : highlighted ? "2" : "1";
  }, [element, selected, highlighted, showReport]);

  const travelReport = travel[0]?.cells;
  const description = report || spotlight?.title || impacts.find(({ cells }) => cells["key-impacts"])?.cells["key-impacts"] ||
    (travelReport && [travelReport.facility, travelReport.details || travelReport.status].filter(Boolean).join(" · ")) ||
    notices[0]?.title;
  const captionAlignment = anchor === "left" ? "left-0" : anchor === "right" ? "right-0" : "left-1/2 -translate-x-1/2";

  return createPortal(
    <div className="relative">
      <Tooltip content={description} type="description" delay={250}>
        <Button
          size="xs"
          variant={selected ? "accent" : "secondary"}
          aria-pressed={selected}
          aria-label={highlighted ? `${label}, mentioned in this report` : label}
          leading={<Icon name={highlighted ? "activity" : "dot"} aria-hidden="true" className={highlighted && !selected ? "text-warning" : undefined} />}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(id);
          }}
        >
          {label}
        </Button>
      </Tooltip>
      {showReport && report && (
        <div aria-hidden="true" className={`pointer-events-none absolute top-full mt-1 w-max ${captionAlignment}`}>
          <Badge className="max-w-48 border border-frame bg-background"><span className="truncate">{report}</span></Badge>
        </div>
      )}
    </div>,
    element,
  );
}

export function StormBriefingMap({ regions, selectedId, highlightedIds, highlightedReport, onSelect }: {
  regions: StormRegion[];
  selectedId: string;
  highlightedIds?: readonly string[];
  highlightedReport?: string;
  onSelect: (id: string) => void;
}) {
  const [map, setMap] = useState<PointMapInstance | null>(null);
  const previousCamera = useRef<{ map: PointMapInstance; key: string }>(null);
  const onLoad = useCallback((loadedMap: PointMapInstance) => {
    setMap(loadedMap);
    loadedMap.once("remove", () => setMap((current) => current === loadedMap ? null : current));
  }, []);

  useEffect(() => {
    if (!map) return;
    const selected = regions.find(({ id }) => id === selectedId);
    const coordinates = regions.map(({ lat, lon }): [number, number] => [lon, lat]);
    const key = selected ? `${selected.id}:${selected.lon}:${selected.lat}:${selected.zoom}` : JSON.stringify(coordinates);
    if (previousCamera.current?.map === map && previousCamera.current.key === key) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = previousCamera.current?.map === map && !reducedMotion ? 650 : 0;
    previousCamera.current = { map, key };

    const container = map.getContainer();
    const cards = container.closest(".fd-workspace-map")?.querySelector(".fd-workspace-map-cards");
    const { clientWidth, clientHeight } = container;
    const padding = Math.min(80, Math.floor(Math.min(clientWidth, clientHeight) * 0.1));
    const cardsInset = cards ? Math.min(cards.getBoundingClientRect().width + padding, clientWidth * 0.62) : 0;
    if (selected || coordinates.length < 2) {
      const camera = selected ?? regions[0] ?? allRegions;
      map.easeTo({ center: [camera.lon, camera.lat], zoom: camera.zoom, offset: [-cardsInset / 2, 0], duration });
      return;
    }

    const bounds = new LngLatBounds();
    coordinates.forEach((coordinate) => bounds.extend(coordinate));
    map.fitBounds(bounds, { padding: { top: padding, bottom: padding, left: padding, right: padding + cardsInset },
      duration, maxZoom: 6 });
  }, [map, regions, selectedId]);

  const captionId = highlightedIds?.find((id) => regions.some((region) => region.id === id));

  return (
    <div className="fd-map-workspace" role="region" aria-label="Storm reports by region">
      <PointMap points={[]} center={allRegions} fill fixedCamera initialStyle="theme" onLoad={onLoad} />
      {map && regions.map((region) => {
        const highlighted = highlightedIds?.includes(region.id) ?? false;
        return (
          <RegionMarker key={region.id} map={map} region={region} selected={selectedId === region.id}
            highlighted={highlighted} report={highlighted ? highlightedReport : undefined}
            showReport={!!highlightedReport && captionId === region.id} onSelect={onSelect} />
        );
      })}
    </div>
  );
}
