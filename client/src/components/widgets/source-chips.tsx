"use client";

import { useRef, useState } from "react";
import { SourceMark } from "@/components/sources/source-mark";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { OriginalWords } from "@/components/sources/original-words";
import { Caption, Text } from "@/components/ui/typography";
import type { Evidence, Source } from "@/lib/spec";
import { excerptOf, hostOf, sourceLabel } from "@/lib/source-brand";
import { ago } from "@/lib/time";

/** Kind of source and when it was published and read, in one line under the publisher. */
function details(s: Source) {
  return [s.sourceType, s.publishedAt ? `published ${ago(s.publishedAt)}` : null, `read ${ago(s.fetchedAt)}`].filter(Boolean).join(", ");
}

/**
 * One source behind a figure: its logo and reference, opening a preview with the publisher, a short passage
 * of the source's own words and a link to the original. Built from the same sw3 parts as CitationChip (a
 * Popover on a small Button), with the publisher's mark in place of the note icon. When the figure's verified
 * sentence comes from this source, the preview shows that sentence instead of a passage of the page.
 */
function SourceChip({ id, source, evidence }: { id: string; source: Source; evidence?: Evidence }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const title = source.title ?? source.url;
  const excerpt = excerptOf(source, 280);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        ref={anchor}
        size="sm"
        variant="secondary"
        className="h-6 gap-1 px-1.5 text-xs"
        leading={<SourceMark source={source} size={14} />}
        aria-label={`Source ${id}: ${title}`}
        data-source-chip={id}
      >
        {id}
      </PopoverTrigger>
      <PopoverContent padding="sm" className="[overflow-wrap:anywhere]">
        <div className="flex items-center gap-2">
          <SourceMark source={source} size="sm" />
          <div className="min-w-0">
            <Text size="sm" className="truncate font-medium">
              {sourceLabel(source)}
            </Text>
            <Text size="sm" tone="muted" className="truncate">
              {details(source)}
            </Text>
          </div>
        </div>
        <PopoverTitle>{title}</PopoverTitle>
        {evidence ? (
          <div className="flex flex-col gap-1.5" data-evidence={id}>
            <Caption>{evidence.original ? "Verified in the source, translated" : "Verified in the source"}</Caption>
            <blockquote className="fd-excerpt" cite={source.url}>
              <Text size="sm">{evidence.quote}</Text>
            </blockquote>
            {evidence.original ? <OriginalWords original={evidence.original} /> : null}
          </div>
        ) : excerpt ? (
          <blockquote className="fd-excerpt" cite={source.url}>
            <Text size="sm" tone="subtle">
              {excerpt}
            </Text>
          </blockquote>
        ) : (
          <PopoverDescription>{hostOf(source.url) ?? "web"}</PopoverDescription>
        )}
        <Button
          href={source.url}
          variant="secondary"
          size="sm"
          trailing={<Icon name="arrow-up-right" />}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open source in a new tab"
          className="self-start"
          onKeyDown={(event) => {
            // The link is the last stop in the preview: Tab hands focus back to the chip and closes it.
            if (event.key !== "Tab" || !anchor.current) return;
            anchor.current.focus({ preventScroll: true });
            if (event.shiftKey) event.preventDefault();
            setOpen(false);
          }}
        >
          Open source
        </Button>
      </PopoverContent>
    </Popover>
  );
}

const linkable = (s: Source) => hostOf(s.url) !== null;

/**
 * The sources behind a figure, one chip each. Ids the board does not know are dropped, and so is a source whose
 * URL is not http(s), so no chip is ever empty.
 */
export function SourceChips({
  ids,
  sources,
  evidence,
}: {
  ids: string[] | undefined;
  sources: Map<string, Source>;
  /** The verified sentence behind this figure. It is shown in the preview of the source it was copied from. */
  evidence?: Evidence;
}) {
  const known = (ids ?? []).filter((id, i, all) => all.indexOf(id) === i && sources.has(id) && linkable(sources.get(id)!));
  if (!known.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {known.map((id) => (
        <SourceChip key={id} id={id} source={sources.get(id)!} evidence={evidence?.source === id ? evidence : undefined} />
      ))}
    </span>
  );
}
