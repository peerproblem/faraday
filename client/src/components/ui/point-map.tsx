"use client";

import { MapView, type MapMarker } from "@sw3/ui/map";

// Next emits the MapLibre worker as a build asset from this URL. MapView passes it to MapLibre before the first map.
const workerUrl = new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString();

export type MapPointKind = NonNullable<MapMarker["kind"]>;
export type MapPoint = { id: string; name: string; lat: number; lon: number; kind: MapPointKind; note?: string };

/** Places on an sw3 MapView, each with its kind's marker, a popup and a line in the locations list below the map. */
export default function PointMap({
  points,
  center,
  label = "Places on the map",
  height = 340,
}: {
  points: MapPoint[];
  center: { lat: number; lon: number; zoom: number } | null;
  label?: string;
  height?: number;
}) {
  const first = points[0];
  return (
    <MapView
      workerUrl={workerUrl}
      height={height}
      markerListLabel={label}
      markers={points.map((p) => ({
        lngLat: [p.lon, p.lat],
        kind: p.kind,
        label: p.name,
        description: p.note || undefined,
        popup: p.note ? { title: p.name, description: p.note } : undefined,
      }))}
      fitToData={points.length > 1}
      center={center ? [center.lon, center.lat] : first ? [first.lon, first.lat] : [0, 20]}
      zoom={center?.zoom ?? (first ? 10 : 1.5)}
    />
  );
}
