import { Ago } from "@/components/ago";
import { BoardBadges } from "@/components/board-grid";
import { SeverityMeter } from "@/components/severity-meter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Caption, Heading, Text } from "@/components/ui/typography";
import { boardUrl } from "@/lib/config";
import { TopicSourceLine } from "@/components/sources/source-mark";
import type { TopicSources } from "@/lib/source-brand";
import { crisisTypes, type BoardCard } from "@/lib/spec";


/** The top ranked topic, drawn large on the home page. The page's Display is its h1, so this title is a Heading. */
export function TopicHero({ topic, sources }: { topic: BoardCard; sources?: TopicSources }) {
  const title = topic.title ?? "Untitled topic";
  return (
    <Card href={boardUrl(topic.slug)} aria-label={title} padding="lg" radius="xl" className="gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Caption>Top story now</Caption>
        <BoardBadges board={topic} />
        <Text as="span" size="sm" tone="muted" className="ml-auto">
          updated <Ago t={topic.updatedAt} />
        </Text>
      </div>
      <Heading as="h3" size="lg">
        {title}
      </Heading>
      {topic.locationName ? <Text tone="muted">{topic.locationName}</Text> : null}
      {topic.headline ? (
        <Text size="lg" tone="subtle" className="max-w-4xl">
          {topic.headline}
        </Text>
      ) : null}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        {typeof topic.severity === "number" ? (
          <div className="w-56 max-w-full">
            <SeverityMeter value={topic.severity} />
          </div>
        ) : null}
        <TopicSourceLine sources={sources} max={7} />
      </div>
    </Card>
  );
}

const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Crisis type filter. Each choice is a page of its own, so it is a row of links (sw3 Buttons with href) that works
 * without JavaScript and keeps each type's page cacheable. The current one is marked with aria-current.
 */
export function TypeFilter({ base, active }: { base: string; active: string | null }) {
  const href = (t: string | null) => {
    const q = new URLSearchParams();
    if (t) q.set("type", t);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const item = (t: string | null, label: string) => (
    <li key={t ?? "all"}>
      <Button href={href(t)} size="sm" radius="full" variant={active === t ? "secondary" : "ghost"}
        aria-current={active === t ? "page" : undefined}>
        {label}
      </Button>
    </li>
  );
  return (
    <nav aria-label="Crisis type">
      <ul className="flex flex-wrap gap-1">
        {item(null, "All")}
        {crisisTypes.map((t) => item(t, typeLabel(t)))}
      </ul>
    </nav>
  );
}

export function EmptyTopics({ type }: { type: string | null }) {
  return (
    <Card variant="muted" padding="lg">
      <EmptyState
        title={type ? `No ${type} topics right now` : "No topics yet"}
        description={
          type ? "Faraday is not following a crisis of this type at the moment." : "Faraday scans the news every half hour and adds crises as they are confirmed."
        }
        action={
          type ? (
            <Button href="/" variant="outline" size="sm">
              Show all topics
            </Button>
          ) : undefined
        }
      />
    </Card>
  );
}
