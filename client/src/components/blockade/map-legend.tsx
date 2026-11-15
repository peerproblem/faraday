"use client";

import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import type { MapPointKind } from "@/lib/spec";

// The glyphs sw3 draws inside each kind of marker, so the legend shows the same mark as the map.
const glyphs: Partial<Record<MapPointKind, { path: string; label: string }>> = {
  impact: { path: "M4 4l6 6m0-6-6 6", label: "Incident reports at sea" },
  incident: { path: "M7 3v4.5m0 3.5h.01", label: "Located incident" },
  closure: { path: "M3 7h8", label: "Crossing closed or restricted" },
  resource: { path: "M3 7h8M7 3v8", label: "Crossing open" },
};

const order: MapPointKind[] = ["impact", "incident", "closure", "resource"];

/** What the marks on the map stand for. Only the kinds on the map are listed. */
export function MapLegend({ kinds, area }: { kinds: MapPointKind[]; area?: string }) {
  const rows = order.filter((kind) => kinds.includes(kind));
  if (!rows.length && !area) return null;
  return (
    <Card padding="none" radius="md" className="fd-blockade-legend" aria-label="Map legend" role="group">
      <ul>
        {rows.map((kind) => (
          <li key={kind}>
            <span className="fd-blockade-glyph" data-kind={kind} aria-hidden="true">
              <svg viewBox="0 0 14 14"><path d={glyphs[kind]!.path} /></svg>
            </span>
            <Text as="span" size="sm">{glyphs[kind]!.label}</Text>
          </li>
        ))}
        {area && (
          <li>
            <span className="fd-blockade-swatch" aria-hidden="true" />
            <Text as="span" size="sm">{area}, warning in force</Text>
          </li>
        )}
      </ul>
    </Card>
  );
}
