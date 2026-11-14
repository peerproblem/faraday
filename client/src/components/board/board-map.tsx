"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { BoardSpec, MapPoint } from "@/lib/spec";

const colors: Record<MapPoint["kind"], string> = {
  impact: "#ef4444",
  incident: "#f97316",
  origin: "#f43f5e",
  closure: "#fbbf24",
  shelter: "#34d399",
  resource: "#60a5fa",
};

function Fit({ points, location }: { points: MapPoint[]; location: BoardSpec["location"] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map((p) => [p.lat, p.lon] as [number, number]), { padding: [30, 30], maxZoom: 11 });
    } else if (location) {
      map.setView([location.lat, location.lon], location.zoom);
    }
  }, [map, points, location]);
  return null;
}

export default function BoardMap({ points, location }: { points: MapPoint[]; location: BoardSpec["location"] }) {
  const center: [number, number] = location ? [location.lat, location.lon] : points[0] ? [points[0].lat, points[0].lon] : [20, 0];
  return (
    <div className="h-[340px] overflow-hidden rounded-lg border border-line">
      <MapContainer center={center} zoom={location?.zoom ?? 5} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="dark-tiles"
        />
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={p.kind === "impact" || p.kind === "origin" ? 10 : 7}
            pathOptions={{ color: colors[p.kind], fillColor: colors[p.kind], fillOpacity: 0.45, weight: 2 }}
          >
            <Popup>
              <strong>{p.name}</strong>
              <br />
              <span style={{ textTransform: "capitalize" }}>{p.kind}</span>: {p.note}
            </Popup>
          </CircleMarker>
        ))}
        <Fit points={points} location={location} />
      </MapContainer>
      <ul className="sr-only">
        {points.map((p) => (
          <li key={p.id}>
            {p.name} ({p.kind}): {p.note}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const mapLegend = colors;
