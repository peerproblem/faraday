"use client";

import { useMemo } from "react";
import { Ago } from "@/components/ago";
import { SourceMark } from "@/components/sources/source-mark";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/components/ui/link";
import { Caption, Text } from "@/components/ui/typography";
import { useArrivals } from "@/lib/client/use-arrivals";
import type { Source } from "@/lib/spec";
import { excerptOf, sourceLabel } from "@/lib/source-brand";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const MIN_RELEVANCE = 0.4;

/** News and monitor sources, newest first, one per headline. */
export function feedItems(sources: Source[], limit = 15): Source[] {
  const seen = new Set<string>();
  return sources
    .filter((s) => s.kind !== "web" && s.kind !== "social" && s.sourceType !== "social" && (s.relevance === null || s.relevance >= MIN_RELEVANCE))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || b.fetchedAt - a.fetchedAt)
    .filter((s) => {
      const key = (s.title ?? s.url).toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function FeedWidget({ allSources, building, filter }: WidgetProps<"feed">) {
  const types = filter?.sourceTypes?.length ? new Set(filter.sourceTypes) : null;
  const news = feedItems(types ? allSources.filter((s) => s.sourceType !== null && types.has(s.sourceType)) : allSources);
  // Coverage that came in over the stream while the board was open is marked and settles into the list.
  const arrived = useArrivals(useMemo(() => allSources.map((s) => s.id), [allSources]));
  if (!news.length) return <Empty building={building} title="No coverage yet" description="News and monitored pages appear here as they are read." />;
  return (
    <ul className="divide-y divide-hairline">
      {news.map((s) => {
        const excerpt = excerptOf(s);
        const fresh = arrived.has(s.id);
        return (
          <li key={s.id} className={`flex gap-3 py-3 first:pt-0 last:pb-0 ${fresh ? "fd-source-enter" : ""}`}>
            <SourceMark source={s} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Text as="div" size="sm" tone="muted" className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-foreground">{sourceLabel(s)}</span>
                <span>{s.publishedAt ? <Ago t={s.publishedAt} /> : "date unknown"}</span>
                {s.kind === "monitor" ? <span>via monitor</span> : null}
                {fresh ? <Badge variant="accent">New</Badge> : null}
                <Caption className="ml-auto">{s.id}</Caption>
              </Text>
              <Text size="sm">
                <Link href={s.url} target="_blank" rel="noreferrer">
                  {s.title ?? s.url}
                </Link>
              </Text>
              {excerpt ? (
                <blockquote className="fd-excerpt" cite={s.url}>
                  <Text size="sm" tone="subtle" className="line-clamp-3">
                    {excerpt}
                  </Text>
                </blockquote>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
