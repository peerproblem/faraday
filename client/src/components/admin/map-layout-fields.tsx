"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { BoardLayout, BoardMapRegion } from "@/lib/spec";

type Camera = Pick<BoardMapRegion, "lat" | "lon" | "zoom">;

function CameraFields({ camera, onChange }: { camera: Camera; onChange: (camera: Camera) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {([
        ["lat", "Latitude", -85, 85],
        ["lon", "Longitude", -180, 180],
        ["zoom", "Zoom", 1, 18],
      ] as const).map(([key, label, min, max]) => (
        <Field key={key} label={label}>
          <Input type="number" step="any" min={min} max={max} required key={camera[key]} defaultValue={camera[key]}
            onBlur={(event) => onChange({ ...camera, [key]: event.currentTarget.valueAsNumber })} />
        </Field>
      ))}
    </div>
  );
}

export function MapLayoutFields({ settings, onChange }: { settings: BoardLayout; onChange: (settings: BoardLayout) => void }) {
  const regions = settings.mapRegions ?? [];
  const save = (mapRegions: BoardMapRegion[]) => onChange({ ...settings, mapRegions });
  const update = (index: number, patch: Partial<BoardMapRegion>) =>
    save(regions.map((region, i) => i === index ? { ...region, ...patch } : region));
  return (
    <>
      <Field label="Right cards position">
        <Select size="sm" value={settings.mapDetails ?? "overlay"}
          onValueChange={(mapDetails) => {
            if (mapDetails === "overlay" || mapDetails === "aside") onChange({ ...settings, mapDetails });
          }}>
          <SelectTrigger className="w-full" />
          <SelectContent>
            <SelectItem value="overlay">Over the map</SelectItem>
            <SelectItem value="aside">Beside the map</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <fieldset className="grid min-w-0 gap-3 border-t border-hairline pt-2">
        <legend className="pr-2 text-sm font-medium">Map regions</legend>
        {regions.map((region, index) => (
          <fieldset key={index} className="grid min-w-0 gap-2">
            <legend className="text-sm font-medium">{index === 0 ? "Default region" : "Alternate region"}</legend>
            <Field label="Region name">
              <Input required value={region.label} maxLength={64} onValueChange={(label) => update(index, { label })} />
            </Field>
            <Field label="Reporting areas" description="Comma-separated area names in official reports. Leave blank to include all areas.">
              <Input key={region.areas.join(",")} defaultValue={region.areas.join(", ")}
                onBlur={(event) => update(index, { areas: event.currentTarget.value.split(",").map((area) => area.trim()).filter(Boolean) })} />
            </Field>
            <CameraFields camera={region} onChange={(camera) => update(index, camera)} />
            {region.inset && <fieldset className="grid min-w-0 gap-2">
              <legend className="text-sm font-medium">Inset map</legend>
              <Field label="Inset name">
                <Input required maxLength={64} value={region.inset.label}
                  onValueChange={(label) => update(index, { inset: { ...region.inset!, label } })} />
              </Field>
              <CameraFields camera={region.inset} onChange={(camera) => update(index, { inset: { ...region.inset!, ...camera } })} />
            </fieldset>}
            <div className="flex flex-wrap gap-1">
              {!region.inset && <Button type="button" size="xs" variant="ghost"
                onClick={() => update(index, { inset: { label: "Inset", lat: region.lat, lon: region.lon, zoom: region.zoom } })}>Add inset</Button>}
              {region.inset && <Button type="button" size="xs" variant="ghost" onClick={() => update(index, { inset: undefined })}>Remove inset</Button>}
              <Button type="button" size="xs" variant="ghost" onClick={() => save(regions.filter((_, i) => i !== index))}>Remove region</Button>
            </div>
          </fieldset>
        ))}
        <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={regions.length >= 6}
          onClick={() => save([...regions, { label: `Region ${regions.length + 1}`, lat: 0, lon: 0, zoom: 4, areas: [] }])}>Add map region</Button>
      </fieldset>
    </>
  );
}
