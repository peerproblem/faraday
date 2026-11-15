"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { LngLatBounds } from "maplibre-gl";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Caption } from "@/components/ui/typography";
import type { BoardMapRegion, MapData } from "@/lib/spec";

const PointMap = dynamic(() => import("@/components/ui/point-map"), { ssr: false });

export function RegionSwitch({ regions, selected, onChange }: {
  regions: BoardMapRegion[];
  selected: string;
  onChange: (label: string) => void;
}) {
  const options = regions.map(({ label }) => ({ value: label, label }));
  if (options.length === 2 && options.every(({ label }) => label.length <= 24)) {
    return <SegmentedControl aria-label="Monitoring region" size="sm" options={options} value={selected} onValueChange={onChange} />;
  }
  return (
    <Select size="sm" aria-label="Monitoring region" value={selected} onValueChange={onChange}>
      <SelectTrigger />
      <SelectContent>
        {options.map(({ label }) => <SelectItem key={label} value={label}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function RegionInset({ inset, points }: {
  inset: NonNullable<BoardMapRegion["inset"]>;
  points: MapData["points"];
}) {
  const [bounds, setBounds] = useState<LngLatBounds>();
  const visible = bounds ? points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 && bounds.contains([point.lon, point.lat])) : [];
  return (
    <section className="fd-board-map-inset" aria-label={`${inset.label} inset map`}>
      <Caption>{inset.label}</Caption>
      <PointMap label={`${inset.label} locations`} points={visible} center={inset} fixedCamera interactive={false} height={104}
        onLoad={(map) => {
          const update = () => setBounds(map.getBounds());
          update();
          map.on("resize", update);
          map.once("remove", () => map.off("resize", update));
        }} />
    </section>
  );
}
