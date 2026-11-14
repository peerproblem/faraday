"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { getVersion, setWorkerUrl } from "maplibre-gl";
import { MapView } from "@sw3/ui/map";

// MapLibre looks for its worker next to its own module, which a bundler has moved. The copy in
// public/vendor (scripts/copy-map-worker.mjs) has a fixed URL; the version keeps an old one out of the cache.
if (typeof window !== "undefined") setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`);

export type MapPoint = { id: string; name: string; lat: number; lon: number; emphasis: "primary" | "secondary" | "default" };

/** sw3 v1 markers come in three looks. Faraday's place kinds are folded onto them until sw3 ships typed markers. */
const markerKind = { primary: "start", secondary: "end", default: "default" } as const;

/** Places on an sw3 MapView. Loaded lazily by the map widget, because MapLibre is large and needs the browser. */
export default function PointMap({
  points,
  center,
  height = 340,
}: {
  points: MapPoint[];
  center: { lat: number; lon: number; zoom: number } | null;
  height?: number;
}) {
  const first = points[0];
  return (
    <MapView
      height={height}
      markers={points.map((p) => ({ lngLat: [p.lon, p.lat], kind: markerKind[p.emphasis], label: points.length <= 6 ? p.name : undefined }))}
      fitToData={points.length > 1}
      center={center ? [center.lon, center.lat] : first ? [first.lon, first.lat] : [0, 20]}
      zoom={center?.zoom ?? (first ? 10 : 1.5)}
    />
  );
}
