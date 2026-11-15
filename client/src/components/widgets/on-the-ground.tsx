"use client";

import { Ago } from "@/components/ago";
import { OriginalWords } from "@/components/sources/original-words";
import { SourceMark } from "@/components/sources/source-mark";
import { Text } from "@/components/ui/typography";
import { brandOf, sourceLabel } from "@/lib/source-brand";
import type { Source } from "@/lib/spec";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

/** The author's display name when the source stored one that is not just the handle again. */
function displayNameOf(s: Source): string | null {
  const name = s.publisher?.trim();
  if (!name || name.startsWith("@") || name === sourceLabel(s) || name.toLowerCase() === brandOf(s).name.toLowerCase()) return null;
  return name;
}

export function OnTheGroundWidget({ data, sources, building }: WidgetProps<"on-the-ground">) {
  if (!data?.items.length) return <Empty building={building} title="No unverified reports" description="Social posts from the area appear here, marked as unverified." />;
  return (
    <div className="flex flex-col gap-3">
      <Text size="sm" tone="muted">Unverified social reports. These claims have not been confirmed by official or news sources.</Text>
      <ul className="grid gap-3 @2xl:grid-cols-2">
        {data.items.map((item) => {
          // A report reads as a post: who said it and where, then their words, then the citation.
          const author = item.sources.map((id) => sources.get(id)).find((s) => s !== undefined);
          return (
            <li key={item.id} className="flex min-w-0 gap-3 rounded-lg bg-muted p-3">
              {author ? <SourceMark source={author} size="sm" /> : null}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {author ? (
                  <Text as="div" size="sm" tone="muted" className="flex flex-wrap items-baseline gap-x-2">
                    {/* X asks for the author's name and @handle together. Older posts only stored the handle. */}
                    {displayNameOf(author) ? <span className="font-medium text-foreground">{displayNameOf(author)}</span> : null}
                    <span className={displayNameOf(author) ? undefined : "font-medium text-foreground"}>{sourceLabel(author)}</span>
                    {brandOf(author).platform ? <span>on {brandOf(author).name}</span> : null}
                    {item.asOf ?? author.publishedAt ? <Ago t={item.asOf ?? author.publishedAt} /> : null}
                  </Text>
                ) : null}
                <Text size="sm">{item.quote}</Text>
                {item.evidence?.original ? (
                  <>
                    <Text size="sm" tone="muted">
                      Translated
                    </Text>
                    <OriginalWords original={item.evidence.original} />
                  </>
                ) : null}
                <SourceChips ids={item.sources} sources={sources} evidence={item.evidence} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
