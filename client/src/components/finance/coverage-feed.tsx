"use client";

import { useMemo, useState } from "react";
import { Ago } from "@/components/ago";
import { SourceMark } from "@/components/sources/source-mark";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { brandOf, excerptOf, handleOf, sourceLabel } from "@/lib/source-brand";
import type { Source } from "@/lib/spec";

const MIN_RELEVANCE = 0.4;
const KINDS = [
  { value: "all", label: "All" },
  { value: "news", label: "News" },
  { value: "monitor", label: "Live pages" },
  { value: "social", label: "Posts" },
] as const;
type Kind = (typeof KINDS)[number]["value"];
const COUNTS = ["8", "16", "32", "all"] as const;
type Count = (typeof COUNTS)[number];
const kindLabel: Record<string, string> = { news: "News", monitor: "Live page", social: "Post" };

/** News, monitored live pages and posts, newest first, one per headline. Reference pages are left out. */
export function coverage(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources
    .filter((s) => s.kind !== "web" && (s.relevance === null || s.relevance >= MIN_RELEVANCE))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || b.fetchedAt - a.fetchedAt)
    .filter((s) => {
      const key = (s.title ?? s.url).toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The board's coverage as a wall of quote cards: who said it (logo, outlet or account), when, the headline and
 * a passage in their own words. A filter by kind and a count keep the wall as long as the reader wants.
 */
export function CoverageFeed({ sources, title }: { sources: Source[]; title: string }) {
  const items = useMemo(() => coverage(sources), [sources]);
  const [kind, setKind] = useState<Kind>("all");
  const [count, setCount] = useState<Count>("8");
  const kinds = KINDS.filter((k) => k.value === "all" || items.some((s) => s.kind === k.value));
  const list = kind === "all" ? items : items.filter((s) => s.kind === kind);
  const shown = count === "all" ? list : list.slice(0, Number(count));
  const next = COUNTS.find((c) => c !== "all" && Number(c) > shown.length) ?? "all";
  const more = Math.min(list.length, next === "all" ? list.length : Number(next)) - shown.length;
  if (!items.length) return null;

  return (
    <>
      <div className="fd-fin__head">
        <div>
          <div className="fd-fin-kicker">Coverage</div>
          <h2 id="fd-fin-feed-h" className="fd-fin__h2">{title}</h2>
        </div>
        <div className="fd-fin__controls" style={{ margin: 0 }}>
          {kinds.length > 2 ? <SegmentedControl aria-label="Kind of coverage" size="sm" value={kind} onValueChange={(v) => setKind(v as Kind)} options={kinds.map((k) => ({ value: k.value, label: k.label }))} /> : null}
          <SegmentedControl aria-label="How many to show" size="sm" value={count} onValueChange={(v) => setCount(v as Count)}
            options={COUNTS.map((c) => ({ value: c, label: c === "all" ? `All ${list.length}` : c }))} />
        </div>
      </div>
      <ul className="fd-fin-feed">
        {shown.map((s) => <Quote key={s.id} source={s} />)}
      </ul>
      <div className="fd-fin__feed-foot">
        <span className="fd-fin-kicker" style={{ textTransform: "none", letterSpacing: 0 }}>Showing {shown.length} of {list.length}</span>
        {shown.length < list.length ? (
          <Button variant="outline" size="sm" onClick={() => setCount(next)}>Show {more} more</Button>
        ) : null}
      </div>
    </>
  );
}

function Quote({ source: s }: { source: Source }) {
  const brand = brandOf(s);
  const handle = handleOf(s.url);
  const excerpt = excerptOf(s, 240);
  // A post's "title" is usually just its account; the text is the excerpt.
  const headline = s.title && !s.title.startsWith("@") && s.title !== handle ? s.title : null;
  return (
    <li className="fd-fin-card" data-kind={s.kind}>
      <div className="fd-fin-card__by">
        <SourceMark source={s} size="md" />
        <div style={{ minWidth: 0 }}>
          <div className="fd-fin-card__name">{sourceLabel(s)}</div>
          <div className="fd-fin-card__meta">
            {kindLabel[s.kind] ?? "Source"}{brand.platform && handle ? ` on ${brand.name}` : ""} · {s.publishedAt ? <Ago t={s.publishedAt} /> : "date unknown"}
          </div>
        </div>
      </div>
      {headline ? <a className="fd-fin-card__title" href={s.url} target="_blank" rel="noreferrer">{headline}</a> : null}
      {excerpt ? <blockquote className="fd-fin-card__quote" cite={s.url}>{excerpt}</blockquote> : null}
      {!headline ? <a className="fd-fin-card__link" href={s.url} target="_blank" rel="noreferrer">Open the {kindLabel[s.kind]?.toLowerCase() ?? "source"}</a> : null}
    </li>
  );
}
