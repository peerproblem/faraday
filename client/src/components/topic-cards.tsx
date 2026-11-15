import { Ago } from "@/components/ago";
import { BoardBadges } from "@/components/board-grid";
import { SeverityMeter } from "@/components/severity-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/skeleton";
import { Caption, Heading, Text } from "@/components/ui/typography";
import { boardUrl } from "@/lib/config";
import { TopicSourceLine } from "@/components/sources/source-mark";
import type { TopicSources } from "@/lib/source-brand";
import { crisisTypes, type BoardCard, type PersonalViewCard } from "@/lib/spec";


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
export function TypeFilter({ base, active, extra = "", compact = false }: { base: string; active: string | null; extra?: string; compact?: boolean }) {
  const href = (t: string | null) => {
    const q = new URLSearchParams(extra);
    if (t) q.set("type", t);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const item = (t: string | null, label: string) => (
    <li key={t ?? "all"}>
      <Button href={href(t)} size="sm" radius={compact ? undefined : "full"} variant={active === t ? "secondary" : "ghost"}
        className={compact ? "w-full justify-start" : undefined} aria-current={active === t ? "page" : undefined}>
        {label}
      </Button>
    </li>
  );
  if (compact) {
    return (
      <nav aria-label="Crisis type">
        <Popover>
          <PopoverTrigger variant="outline" size="sm" aria-label={`Category: ${active ? typeLabel(active) : "All categories"}`}
            trailing={<Icon name="chevron-down" width={14} height={14} />}>
            {active ? typeLabel(active) : "All categories"}
          </PopoverTrigger>
          <PopoverContent align="end" padding="sm" aria-label="Topic categories">
            <ul className="grid max-h-64 gap-1 overflow-y-auto">
              {item(null, "All categories")}
              {crisisTypes.map((type) => item(type, typeLabel(type)))}
            </ul>
          </PopoverContent>
        </Popover>
      </nav>
    );
  }
  return (
    <nav aria-label="Crisis type">
      <ul className="flex flex-wrap gap-1">
        {item(null, "All")}
        {crisisTypes.map((t) => item(t, typeLabel(t)))}
      </ul>
    </nav>
  );
}

/** The person's dashboards, as a compact row on the home page or a grid on /me. */
export function MyDashboards({ views, compact = false }: { views: PersonalViewCard[]; compact?: boolean }) {
  if (!views.length) {
    return (
      <Card variant="muted" padding={compact ? "md" : "lg"}>
        <EmptyState
          headingLevel={compact ? 3 : 2}
          title="No dashboards yet"
          description="Open a topic and choose Add to my dashboard to shape it your way."
          action={
            <Button href="/topics" variant="outline" size="sm">
              Browse topics
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <ul className={compact ? "flex gap-3 overflow-x-auto pb-1" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
      {views.map((v) => {
        const title = v.title ?? "Untitled topic";
        return (
          <li key={v.id} className={compact ? "w-72 max-w-[80vw] shrink-0" : "min-w-0"}>
            <Card href={`/me/${v.slug}`} aria-label={title} padding="md" className="h-full gap-2">
              <div className="flex items-center gap-2">
                {v.changedSinceVisit ? (
                  <Badge variant="accent">New updates</Badge>
                ) : (
                  <Text as="span" size="sm" tone="muted">
                    No news since your last visit
                  </Text>
                )}
                <Text as="span" size="sm" tone="muted" className="ml-auto">
                  <Ago t={v.updatedAt} />
                </Text>
              </div>
              <CardTitle as="h3">{title}</CardTitle>
              {!compact && v.headline ? (
                <Text size="sm" tone="muted" className="line-clamp-2">
                  {v.headline}
                </Text>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
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
