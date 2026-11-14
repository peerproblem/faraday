"use client";

import { Avatar, AvatarFallback, AvatarGroup, type AvatarSize } from "@/components/ui/avatar";
import { Text } from "@/components/ui/typography";
import type { Source } from "@/lib/spec";
import { brandOf, type Outlet, type SourceBrand, type TopicSources } from "@/lib/source-brand";
import { glyphs } from "@/lib/source-glyphs";

type MarkSize = AvatarSize | number;

/**
 * The logo of a source: the platform's mark for a post (X, Reddit, YouTube...), otherwise the publisher's own
 * icon, with its initial while the icon loads and when there is none. Display only; the name beside it (or the
 * hidden one here) says who it is.
 */
export function BrandMark({ brand, size, named = false }: { brand: SourceBrand; size?: MarkSize; /** True when no visible name sits beside the mark. */ named?: boolean }) {
  if (brand.platform) {
    const g = glyphs[brand.platform];
    return (
      <Avatar shape="squircle" size={size} data-platform={brand.platform}>
        <AvatarFallback>
          <svg viewBox="0 0 24 24" width="60%" height="60%" aria-hidden="true" focusable="false" fill={g.color ?? "currentColor"}>
            <path d={g.path} />
          </svg>
          {named ? <span className="sr-only">{g.name}</span> : null}
        </AvatarFallback>
      </Avatar>
    );
  }
  return <Avatar shape="squircle" size={size} src={brand.logo ?? undefined} name={brand.name} alt={named ? brand.name : ""} delay={250} className="fd-logo" />;
}

export function SourceMark({ source, size, named }: { source: Pick<Source, "url" | "publisher">; size?: MarkSize; named?: boolean }) {
  return <BrandMark brand={brandOf(source)} size={size} named={named} />;
}

const listed = (names: string[], rest: number) => {
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
};

/** The outlets behind a board as a row of overlapping logos, the most cited first, then "+N". */
export function SourceStack({ outlets, max = 5, size = "sm" }: { outlets: Outlet[]; max?: number; size?: MarkSize }) {
  if (!outlets.length) return null;
  const shown = outlets.slice(0, max);
  return (
    <AvatarGroup aria-label={`Sources: ${listed(shown.map((o) => o.name), outlets.length - shown.length)}`} max={max} size={size} shape="squircle" overlap={0.14} className="shrink-0">
      {outlets.map((o) => (
        <BrandMark key={o.key} brand={o} named />
      ))}
    </AvatarGroup>
  );
}

/** The outlets behind a topic as logos, with the count in words. */
export function TopicSourceLine({ sources, max = 5 }: { sources: TopicSources | undefined; max?: number }) {
  if (!sources?.count) return null;
  return (
    <div className="flex items-center gap-2">
      <SourceStack outlets={sources.outlets} max={max} />
      <Text as="span" size="sm" tone="muted">
        {sources.count} sources{sources.outletCount > 1 ? `, ${sources.outletCount} outlets` : ""}
      </Text>
    </div>
  );
}
