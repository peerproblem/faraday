"use client";

import type { ReactNode } from "react";
import { BarList } from "@sw3/ui/charts";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "@/components/widgets/source-chips";
import type { Source, TableData } from "@/lib/spec";
import { toMs, when } from "@/lib/time";

const airports = [
  { facility: "Lisbon Airport", label: "Lisbon", regionId: "portugal" },
  { facility: "Madeira Airport", label: "Madeira", regionId: "madeira" },
];

const cancellationBreakdown = /^([\d,]+) flights? cancelled by 11\s*am\s*\(([\d,]+) in advance,\s*([\d,]+) during (?:operations|the morning)\)\.?$/i;

function airportReport(travel: TableData, facility: string, label: string) {
  for (const row of travel.rows) {
    if (row.cells.facility !== facility || row.cells.country !== "Portugal") continue;
    const figures = row.cells.details?.trim().match(cancellationBreakdown);
    const recordedAt = toMs(row.asOf);
    if (!figures || recordedAt === null) continue;

    const [total, advance, dayOf] = figures.slice(1).map((figure) => Number(figure.replaceAll(",", "")));
    if (advance + dayOf !== total) continue;

    return { label, total, advance, dayOf, recordedAt, sources: row.sources, evidence: row.evidence };
  }
}

export function StormBriefingChart({ travel, sources, onSelectAirport, fallback = null }: {
  travel?: TableData;
  sources: Map<string, Source>;
  onSelectAirport?: (regionId: string) => void;
  fallback?: ReactNode;
}) {
  if (!travel) return fallback;
  const [lisbon, madeira] = airports.map(({ facility, label }) => airportReport(travel, facility, label));

  // Keep one window and source for the comparison. Other rows may overlap with these or use a different cutoff.
  if (!lisbon || !madeira || lisbon.recordedAt !== madeira.recordedAt) return fallback;
  const commonSources = lisbon.sources.filter((id) => madeira.sources.includes(id));
  if (!commonSources.length) return fallback;

  const reports = [
    { ...lisbon, regionId: airports[0].regionId },
    { ...madeira, regionId: airports[1].regionId },
  ];
  const cutoff = new Date(lisbon.recordedAt).toISOString();
  const summary = reports.map(({ label, total, advance, dayOf }) =>
    `${label}: ${total} total, ${advance} in advance and ${dayOf} that morning`).join(". ");
  const count = new Intl.NumberFormat("en-GB");
  return (
    <div style={{ display: "grid", gap: "var(--sw-space-2)", minWidth: 0 }}>
      <BarList
        aria-label={`Flight cancellations by airport. ${summary}.`}
        items={reports.map(({ label, regionId, total, advance, dayOf }) => ({
          id: regionId, label, value: total, meta: `${count.format(advance)} + ${count.format(dayOf)}`,
        }))}
        format={(value) => count.format(value)}
        onItemAction={onSelectAirport}
      />
      <Text size="sm" tone="muted">In advance + that morning</Text>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--sw-space-2)" }}>
        <Text as="span" size="sm" tone="muted">By <time dateTime={cutoff}>{when(cutoff)}</time></Text>
        <SourceChips ids={commonSources} sources={sources} evidence={lisbon.evidence ?? madeira.evidence} compactLabel />
      </div>
    </div>
  );
}
