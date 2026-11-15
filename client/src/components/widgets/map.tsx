"use client";

import { useRef, useState } from "react";
import type { PointMapInstance } from "@/components/ui/point-map";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, Text } from "@/components/ui/typography";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const PointMap = dynamic(() => import("@/components/ui/point-map"), {
  ssr: false,
  loading: () => <Skeleton height={340} radius="lg" />,
});

export function MapWidget({ data, sources, tier, building, filter, fillMap }: WidgetProps<"map">) {
  const mapRef = useRef<PointMapInstance | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const kinds = filter?.pointKinds?.length ? new Set(filter.pointKinds) : null;
  const points = (data?.points ?? []).filter(
    (p) =>
      p &&
      typeof p.id === "string" &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lon) <= 180 &&
      (!kinds || kinds.has(p.kind)),
  );
  const c = data?.center ?? null;
  const center = c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Number.isFinite(c.zoom) ? c : null;
  if (!points.length && !center) return <Empty building={building} title="No places to map" description="The sources have not named any places yet." />;
  const markers = points.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, note: p.note }));
  if (fillMap) {
    return (
      <div className="fd-map-workspace">
        <PointMap points={markers} center={center} fill onLoad={(map) => { mapRef.current = map; }} />
        {points.length > 0 && (
          <div className="fd-map-places">
            <Popover open={placesOpen} onOpenChange={setPlacesOpen}>
              <PopoverTrigger variant="secondary" size="sm">Places · {points.length}</PopoverTrigger>
              <PopoverContent side="top" align="start" aria-label="Places on the map" className="max-w-[min(22rem,calc(100vw-2rem))]">
                <ScrollArea aria-label="Map locations" maxHeight={320}>
                  <ul className="flex flex-col divide-y divide-hairline">
                    {points.map((point) => (
                      <li key={point.id} className="grid min-w-0 gap-1 py-2">
                        <Button size="sm" variant="ghost" aria-label={`Locate ${point.name} on the map`} onClick={() => {
                          const map = mapRef.current;
                          if (!map?.getContainer().isConnected) return;
                          map.easeTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 12) });
                          setPlacesOpen(false);
                        }}>{point.name}</Button>
                        {point.note && <Text size="sm" tone="muted">{point.note}</Text>}
                        <SourceChips ids={point.sources} sources={sources} evidence={point.evidence} />
                        <AsOf t={point.asOf} tier={tier} />
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    );
  }
  // MapView draws each kind with its own marker and lists every place with its kind and note under the map.
  // The citations cannot go in that plain-text list, so they follow it, one line per cited place.
  const cited = points.filter((p) => p.sources?.length || p.asOf);
  return (
    <div className="flex flex-col gap-4">
      <PointMap points={markers} center={center} />
      {cited.length ? (
        <section aria-label="Sources for the places" className="flex flex-col gap-2">
          <Caption>Sources</Caption>
          <ul className="grid gap-x-6 gap-y-1.5 @md:grid-cols-2">
            {cited.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Text as="span" size="sm" className="min-w-0 [overflow-wrap:anywhere]">
                  {p.name}
                </Text>
                <SourceChips ids={p.sources} sources={sources} evidence={p.evidence} />
                <AsOf t={p.asOf} tier={tier} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
