"use client";

import { Ago } from "@/components/ago";
import { TextLink } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import type { Source } from "@/lib/spec";
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

export function FeedWidget({ allSources, building }: WidgetProps<"feed">) {
  const news = feedItems(allSources);
  if (!news.length) return <Empty building={building}>No coverage yet.</Empty>;
  return (
    <ul className="divide-y divide-hairline">
      {news.map((s) => (
        <li key={s.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
          <Text size="sm">
            <TextLink href={s.url} external>
              {s.title ?? s.url}
            </TextLink>
          </Text>
          <Text as="div" size="sm" tone="muted" className="flex flex-wrap gap-x-2">
            <span className="font-mono text-xs">{s.id}</span>
            <span>{s.publisher ?? "web"}</span>
            <span>{s.publishedAt ? <Ago t={s.publishedAt} /> : "date unknown"}</span>
            {s.kind === "monitor" ? <span>via monitor</span> : null}
          </Text>
        </li>
      ))}
    </ul>
  );
}
