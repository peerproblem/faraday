"use client";

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

export function MapWidget({ data, sources, tier, building, filter }: WidgetProps<"map">) {
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
  // MapView draws each kind with its own marker and lists every place with its kind and note under the map.
  // The citations cannot go in that plain-text list, so they follow it, one line per cited place.
  const cited = points.filter((p) => p.sources?.length || p.asOf);
  return (
    <div className="flex flex-col gap-4">
      <PointMap points={points.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, note: p.note }))} center={center} />
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
