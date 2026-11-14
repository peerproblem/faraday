"use client";

import { CitationChip } from "@/components/ui/citation";
import type { Source } from "@/lib/spec";
import { ago } from "@/lib/time";

/** Publisher, kind of source and when it was published and read, in one line for the citation preview. */
function details(s: Source) {
  return [s.publisher ?? "web", s.sourceType, s.publishedAt ? `published ${ago(s.publishedAt)}` : null, `read ${ago(s.fetchedAt)}`].filter(Boolean).join(", ");
}

/** The citation preview takes a short passage, so a long snippet is cut at a word. */
function excerpt(text: string | null): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  if (t.length <= 280) return t;
  return `${t.slice(0, 280).replace(/\s+\S*$/, "")}…`;
}

/**
 * The sources behind a figure, one sw3 CitationChip each. Ids the board does not know are dropped, and
 * CitationChip itself drops a source whose URL is not http(s), so no chip is ever empty.
 */
export function SourceChips({ ids, sources }: { ids: string[] | undefined; sources: Map<string, Source> }) {
  const known = (ids ?? []).filter((id, i, all) => sources.has(id) && all.indexOf(id) === i);
  if (!known.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {known.map((id) => {
        const s = sources.get(id)!;
        return <CitationChip key={id} reference={id} title={s.title ?? s.url} href={s.url} publisher={details(s)} excerpt={excerpt(s.snippet)} />;
      })}
    </span>
  );
}
