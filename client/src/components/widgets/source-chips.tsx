"use client";

import { createContext, useContext, useId, useRef, useState } from "react";
import { SourceMark } from "@/components/sources/source-mark";
import { Link } from "@/components/ui/link";
import { CitationChip } from "@/components/ui/citation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { OriginalWords } from "@/components/sources/original-words";
import { Caption, Text } from "@/components/ui/typography";
import type { Evidence, LinkListData, Source } from "@/lib/spec";
import { excerptOf, hostOf, sourceLabel } from "@/lib/source-brand";
import { ago } from "@/lib/time";

export const OfficialReleasesContext = createContext<LinkListData["items"]>([]);

/** Ignore fragments and campaign parameters when identifying the same release. */
export function evidenceUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "origin") url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.host + url.pathname.replace(/\/$/, "") + url.search;
  } catch {
    return value;
  }
}

export function OfficialReleases({ releases }: { releases: LinkListData["items"] }) {
  if (!releases.length) return null;
  return (
    <ul aria-label="Additional official releases" className="grid gap-1.5">
      {releases.map((release) => (
        <li key={release.id}>
          <Text size="sm"><Link href={release.url} target="_blank" rel="noreferrer">{release.label}</Link></Text>
        </li>
      ))}
    </ul>
  );
}

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
  collapseAt,
}: {
  ids: string[] | undefined;
  sources: Map<string, Source>;
  /** The verified sentence behind this figure. It is shown in the preview of the source it was copied from. */
  evidence?: Evidence;
  collapseAt?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const groupId = useId();
  const known = (ids ?? []).filter((id, i, all) => all.indexOf(id) === i && sources.has(id) && linkable(sources.get(id)!));
  const releases = useContext(OfficialReleasesContext);
  const seen = new Set(known.map((id) => evidenceUrl(sources.get(id)!.url)));
  const related = releases.filter((release) => {
    const url = evidenceUrl(release.url);
    if (seen.has(url) || !(release.sources ?? []).some((id) => known.includes(id))) return false;
    seen.add(url);
    return true;
  });
  if (!known.length) return null;
  const chips = (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {known.map((id) => (
        <SourceChip key={id} id={id} source={sources.get(id)!} evidence={evidence?.source === id ? evidence : undefined} />
      ))}
      {related.map((release) => (
        <CitationChip key={release.id} reference="Official" title={release.label} href={release.url}
          publisher="Official release referenced by a cited source" excerpt={release.note || undefined} />
      ))}
    </span>
  );
  if (collapseAt === undefined || known.length < collapseAt) return chips;

  const contextCount = known.filter((id) => sources.get(id)?.via === "contextdev").length;
  return (
    <span className="fd-deck-citation-group">
      <Button size="sm" variant="secondary" aria-expanded={expanded} aria-controls={groupId}
        trailing={<Icon name={expanded ? "chevron-up" : "chevron-down"} />}
        onClick={() => setExpanded((value) => !value)}>
        Sources ({known.length}){contextCount > 0 ? ` · ${contextCount} via Context.dev` : ""}
      </Button>
      <span id={groupId} className="fd-deck-citation-group-body" hidden={!expanded}>
        {expanded && chips}
      </span>
    </span>
  );
}
