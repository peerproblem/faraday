"use client";

import { CitationChip } from "@/components/ui/citation";
import type { Source } from "@/lib/spec";
import { ago } from "@/lib/time";

function meta(s: Source) {
  return [s.publisher ?? "web", s.sourceType, s.publishedAt ? `published ${ago(s.publishedAt)}` : null, `read ${ago(s.fetchedAt)}`].filter(Boolean).join(", ");
}

/** The sources behind a figure, one chip each. Ids the board does not know are dropped, so no chip is ever empty. */
export function SourceChips({ ids, sources }: { ids: string[] | undefined; sources: Map<string, Source> }) {
  const known = (ids ?? []).filter((id, i, all) => sources.has(id) && all.indexOf(id) === i);
  if (!known.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {known.map((id) => {
        const s = sources.get(id)!;
        return (
          <CitationChip
            key={id}
            citation={{ id, label: `Source ${id}: ${s.publisher ?? s.url}`, title: s.title ?? s.url, meta: meta(s), snippet: s.snippet, href: s.url }}
          />
        );
      })}
    </span>
  );
}
