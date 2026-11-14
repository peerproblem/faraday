"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "@/components/ui/point-map";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import type { MapPointKind } from "@/lib/spec";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const PointMap = dynamic(() => import("@/components/ui/point-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-85" />,
});

/** Where the crisis is (primary), where help is (secondary), and everything else. The list below names each kind in words. */
export const emphasis: Record<MapPointKind, MapPoint["emphasis"]> = {
  impact: "primary",
  origin: "primary",
  shelter: "secondary",
  resource: "secondary",
  incident: "default",
  closure: "default",
};

const marker: Record<MapPoint["emphasis"], string> = {
  primary: "bg-accent",
  secondary: "border-2 border-accent bg-background",
  default: "bg-foreground",
};

export function MapWidget({ data, sources, tier, building }: WidgetProps<"map">) {
  const points = (data?.points ?? []).filter(
    (p) => p && typeof p.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180,
  );
  const c = data?.center ?? null;
  const center = c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Number.isFinite(c.zoom) ? c : null;
  if (!points.length && !center) return <Empty building={building}>No places to map.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <PointMap points={points.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, emphasis: emphasis[p.kind] ?? "default" }))} center={center} />
      {points.length ? (
        <ul className="grid gap-x-6 gap-y-2 @md:grid-cols-2" aria-label="Places on the map">
          {points.map((p) => (
            <li key={p.id} className="flex min-w-0 items-start gap-2.5">
              <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${marker[emphasis[p.kind] ?? "default"]}`} />
              <Text as="div" size="sm" className="min-w-0">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground"> ({p.kind})</span>
                {p.note ? <span className="text-subtle">: {p.note}</span> : null} <SourceChips ids={p.sources} sources={sources} />{" "}
                <AsOf t={p.asOf} tier={tier} />
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
