"use client";

import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import type { Source } from "@/lib/spec";
import { ago } from "@/lib/time";

export function SourceChips({ ids, sources }: { ids: string[] | undefined; sources: Map<string, Source> }) {
  if (!ids?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => {
        const s = sources.get(id);
        if (!s) return null;
        return (
          <Popover key={id}>
            <PopoverTrigger
              aria-label={`Source ${id}: ${s.publisher ?? s.url}`}
              className="rounded border border-line-strong bg-panel px-1.5 py-px font-mono text-[10px] leading-4 text-muted hover:border-accent hover:text-text"
            >
              {id}
            </PopoverTrigger>
            <PopoverContent side="top">
              <PopoverTitle className="text-sm font-semibold leading-snug">{s.title ?? s.url}</PopoverTitle>
              <PopoverDescription className="mt-1 text-xs text-muted">
                {s.publisher ?? "web"}
                {s.publishedAt ? ` · published ${ago(s.publishedAt)}` : ""} · read {ago(s.fetchedAt)}
              </PopoverDescription>
              {s.snippet ? <p className="mt-2 line-clamp-5 text-xs text-muted">{s.snippet}</p> : null}
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block truncate text-xs text-accent underline"
              >
                {s.url}
              </a>
            </PopoverContent>
          </Popover>
        );
      })}
    </span>
  );
}
