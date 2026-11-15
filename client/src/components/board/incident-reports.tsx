"use client";

import { useId } from "react";
import { BarList, ChartCard, DonutChart } from "@sw3/ui/charts";
import { useCurrentTime } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/components/ui/link";
import { Caption, Text } from "@/components/ui/typography";
import { when } from "@/lib/time";
import { getIncidentReports } from "./incident-reports-data";

const count = new Intl.NumberFormat("en-GB");

export function IncidentReports({ kind, chart = "none", hideEmpty = false, ...props }: Omit<Parameters<typeof getIncidentReports>[0], "now"> & {
  kind: "incident-status" | "official-tally";
  chart?: "none" | "donut" | "bars";
  hideEmpty?: boolean;
}) {
  const now = useCurrentTime();
  const id = useId();
  const { incidents, tallies } = getIncidentReports({ ...props, now });
  if (hideEmpty && !(kind === "incident-status" ? incidents.length : tallies.length)) return null;

  return (
    kind === "incident-status" ? (
      <section aria-labelledby={`${id}-active`}>
        <h4 id={`${id}-active`} className="mb-1 text-sm font-semibold">Action needed now</h4>
        {incidents.length ? (
          <ul className="m-0 list-none divide-y divide-hairline p-0">
            {incidents.map((incident) => (
              <li key={incident.id} className="grid min-w-0 gap-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Text size="sm" className="font-semibold">{incident.name}</Text>
                  <Badge variant="warning">{incident.status}</Badge>
                </div>
                <Text size="sm" tone="muted">
                  {incident.area}{incident.until && <> · Valid until <time dateTime={incident.until}>{when(incident.until)}</time></>}
                </Text>
                <Caption>
                  Status reported <time dateTime={incident.observedAt}>{when(incident.observedAt)}</time>
                  {" · "}<Link href={incident.source.url} target="_blank" rel="noreferrer">{incident.source.publisher ?? new URL(incident.source.url).hostname}</Link>
                </Caption>
              </li>
            ))}
          </ul>
        ) : <Text size="sm" tone="muted">No current response status has been verified for this region.</Text>}
      </section>
    ) : (
      <section aria-labelledby={`${id}-totals`} className="grid gap-2">
        <h4 id={`${id}-totals`} className="text-sm font-semibold">Latest official tally</h4>
        {!tallies.length && <Text size="sm" tone="muted">No official tally with a confirmed reporting cutoff is available.</Text>}
        {tallies.map((report) => {
          const slices = report.breakdown?.map((item, index) => ({ ...item, color: `var(--sw-chart-${index + 1})` }));
          return (
            <div key={report.area} className="grid min-w-0 gap-1.5">
              <Text size="sm" className="font-semibold">{report.area}</Text>
              <Text size="sm" tone="muted">
                {report.from ? (
                  <>From <time dateTime={report.from}>{when(report.from)}</time> to </>
                ) : "Through "}
                <time dateTime={report.through}>{when(report.through)}</time>
              </Text>
              <Text size="sm" tone="muted">
                <Link href={report.url} target="_blank" rel="noreferrer">{report.issuer} official report</Link>
              </Text>
              {slices?.length && chart !== "none" ? (
                <ChartCard title="Incidents by type" aria-label={`Incident types in ${report.area}`} padding="none" bordered={false}
                  legend={chart === "donut" && slices.length <= 6 && report.total > 0 ? slices.map((item) => ({
                    key: item.label, label: `${item.label} · ${count.format(item.value)}`, color: item.color,
                  })) : undefined}>
                  {chart === "donut" && slices.length <= 6 && report.total > 0
                    ? <DonutChart data={slices} height={152} arcWidth={22} centralLabel={count.format(report.total)} centralSubLabel="incidents"
                        aria-label={`${report.area}: ${count.format(report.total)} total incidents. ${slices.map((item) => `${item.label}: ${item.value}`).join(". ")}`} />
                    : <><Text size="sm"><strong>{count.format(report.total)}</strong> incidents</Text>
                        <BarList items={slices.map((slice) => ({ id: slice.label, label: slice.label, value: slice.value }))}
                          aria-label={`Incident counts by type in ${report.area}`} /></>}
                </ChartCard>
              ) : <Text size="sm"><strong>{count.format(report.total)}</strong> incidents</Text>}
            </div>
          );
        })}
      </section>
    )
  );
}
