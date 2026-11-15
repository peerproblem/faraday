"use client";

import { useContext, useMemo, useState } from "react";
import { Ago } from "@/components/ago";
import { BrandMark, SourceMark } from "@/components/sources/source-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Caption, Text } from "@/components/ui/typography";
import type { SourceType } from "@/lib/spec";
import { brandOf, outletsOf } from "@/lib/source-brand";
import { evidenceUrl, OfficialReleases, OfficialReleasesContext } from "./source-chips";
import type { WidgetProps } from "./types";

const STEP = 20;
/** Outlets offered as filters. The rest are still in the list. */
const OUTLETS = 14;

export function SourcesWidget({ widget, allSources }: WidgetProps<"sources">) {
  const releases = useContext(OfficialReleasesContext);
  const knownUrls = new Set(allSources.map((source) => evidenceUrl(source.url)));
  const additionalReleases = releases.filter((release) => {
    const url = evidenceUrl(release.url);
    if (knownUrls.has(url)) return false;
    knownUrls.add(url);
    return true;
  });
  const [limit, setLimit] = useState(STEP);
  const [outlet, setOutlet] = useState<string | null>(null);
  const outlets = useMemo(() => outletsOf(allSources), [allSources]);
  const byType = allSources.reduce<Partial<Record<SourceType | "untriaged", number>>>((acc, s) => {
    const k = s.sourceType ?? "untriaged";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  // An outlet that left the board (its sources were discarded) cannot stay selected.
  const active = outlet && outlets.some((o) => o.key === outlet) ? outlet : null;
  const matching = active ? allSources.filter((s) => brandOf(s).key === active) : allSources;
  const shown = matching.slice(0, limit);
  const breakdown = Object.entries(byType)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  const pick = (key: string | null) => {
    setOutlet(key);
    setLimit(STEP);
  };
  return (
    <div className="flex flex-col gap-3">
      <Text size="sm" tone="subtle">
        {allSources.length} sources from the live web across {outlets.length} {outlets.length === 1 ? "outlet" : "outlets"}, read through Context.dev
        {breakdown ? ` (${breakdown})` : null}
      </Text>
      {outlets.length > 1 ? (
        <ul aria-label="Filter by outlet" className="flex flex-wrap gap-1">
          <li>
            <Button size="sm" radius="full" variant={active === null ? "secondary" : "ghost"} aria-pressed={active === null} onClick={() => pick(null)}>
              All
            </Button>
          </li>
          {outlets.slice(0, OUTLETS).map((o) => (
            <li key={o.key}>
              <Button
                size="sm"
                radius="full"
                variant={active === o.key ? "secondary" : "ghost"}
                aria-pressed={active === o.key}
                aria-label={`${o.name}, ${o.count} ${o.count === 1 ? "source" : "sources"}`}
                leading={<BrandMark brand={o} size={16} />}
                onClick={() => pick(active === o.key ? null : o.key)}
              >
                <span className="flex items-baseline gap-1.5">
                  {o.name}
                  <Caption>{o.count}</Caption>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {matching.length ? (
        <ScrollArea maxHeight={320} aria-label={`${widget.title} list`}>
          <ol className="grid gap-2">
            {shown.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-2">
                <SourceMark source={s} size="xs" />
                <Caption className="w-8 shrink-0">{s.id}</Caption>
                <Text as="span" size="sm" tone="muted" className="hidden w-20 shrink-0 @md:inline">
                  {s.sourceType ?? s.kind}
                </Text>
                <Text as="span" size="sm" className="min-w-0 flex-1 truncate">
                  <Link href={s.url} target="_blank" rel="noreferrer">
                    {s.publisher ? `${s.publisher}: ` : ""}
                    {s.title ?? s.url}
                  </Link>
                </Text>
                {s.via === "oxylabs" ? (
                  <Badge variant="outline" mono className="shrink-0">
                    via Oxylabs
                  </Badge>
                ) : null}
                {s.publishedAt ? (
                  <Text as="span" size="sm" tone="muted" className="hidden shrink-0 @2xl:inline">
                    <Ago t={s.publishedAt} />
                  </Text>
                ) : null}
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : null}
      {!active && <OfficialReleases releases={additionalReleases} />}
      {matching.length > limit ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + STEP)}>
            Show {Math.min(STEP, matching.length - limit)} more sources
          </Button>
        </div>
      ) : null}
    </div>
  );
}
