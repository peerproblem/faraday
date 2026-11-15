"use client";

import { useRef, useState } from "react";
import type { JumpToOptions, Map } from "maplibre-gl";
import { MapView, type MapMarker } from "@sw3/ui/map";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { SegmentedControl } from "./segmented-control";

export type { Map as PointMapInstance } from "maplibre-gl";

// Next emits the MapLibre worker as a build asset from this URL. MapView passes it to MapLibre before the first map.
const workerUrl = new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString();

const basemaps = {
  streets: { label: "Streets", style: "bright" },
  theme: { label: "Auto Light/Dark", style: "auto" },
  satellite: { label: "Satellite", style: "/maps/sentinel-2.json" },
} as const;

type MapStyle = keyof typeof basemaps;
const mapStyles: MapStyle[] = ["streets", "theme"];
// Public 2025 imagery is licensed for non-commercial use. Expose it in the local preview.
if (process.env.NODE_ENV === "development") mapStyles.push("satellite");
const styleOptions = mapStyles.map((value) => ({ value, label: basemaps[value].label }));

export type MapPointKind = NonNullable<MapMarker["kind"]>;
export type MapPoint = { id: string; name: string; lat: number; lon: number; kind: MapPointKind; note?: string };

/** Places on an sw3 MapView, each with its kind's marker, a popup and a line in the locations list below the map. */
export default function PointMap({
  points,
  center,
  label = "Places on the map",
  height = 340,
  fill = false,
  onLoad,
}: {
  points: MapPoint[];
  center: { lat: number; lon: number; zoom: number } | null;
  label?: string;
  height?: number;
  fill?: boolean;
  onLoad?: (map: Map) => void;
}) {
  const [style, setStyle] = useState<MapStyle>("streets");
  const [styleOpen, setStyleOpen] = useState(false);
  const mapRef = useRef<Map | null>(null);
  const pendingCamera = useRef<JumpToOptions | null>(null);
  const first = points[0];

  function changeStyle(next: MapStyle) {
    setStyleOpen(false);
    if (next === style) return;
    const map = mapRef.current;
    if (map) {
      pendingCamera.current = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        padding: map.getPadding(),
      };
    }
    setStyle(next);
  }

  function handleMapLoad(map: Map) {
    mapRef.current = map;
    map.once("remove", () => {
      if (mapRef.current === map) mapRef.current = null;
    });
    if (pendingCamera.current) {
      map.jumpTo(pendingCamera.current);
      pendingCamera.current = null;
    }
    onLoad?.(map);
  }
  return (
    <MapView
      workerUrl={workerUrl}
      className={fill ? "fd-map-fill" : undefined}
      radius={fill ? 0 : undefined}
      bordered={!fill}
      onLoad={handleMapLoad}
      basemap={basemaps[style].style}
      controls={
        <Popover open={styleOpen} onOpenChange={setStyleOpen}>
          <PopoverTrigger
            variant="secondary"
            size="md"
            iconOnly
            aria-label="Map style"
            title={`Map style · ${basemaps[style].label}`}
            leading={
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5" />
              </svg>
            }
          />
          <PopoverContent
            aria-label="Map style"
            side="bottom"
            align="end"
            padding="sm"
            style={{ width: "max-content", maxWidth: "var(--sw-popup-available-width, 100vw)" }}
          >
            <SegmentedControl<MapStyle>
              aria-label="Map style"
              size="sm"
              options={styleOptions}
              value={style}
              onValueChange={changeStyle}
            />
          </PopoverContent>
        </Popover>
      }
      height={height}
      markerListLabel={label}
      markers={points.map((p) => ({
        lngLat: [p.lon, p.lat],
        kind: p.kind,
        label: fill ? undefined : p.name,
        description: p.note || undefined,
        popup: p.note || fill ? { title: p.name, description: p.note ?? "" } : undefined,
      }))}
      fitToData={points.length > 1}
      center={center ? [center.lon, center.lat] : first ? [first.lon, first.lat] : [0, 20]}
      zoom={center?.zoom ?? (first ? 10 : 1.5)}
    />
  );
}
