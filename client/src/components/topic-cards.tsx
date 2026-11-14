import Link from "next/link";
import { Ago } from "@/components/ago";
import { boardBadge } from "@/components/board-grid";
import { SeverityMeter } from "@/components/severity-meter";
import { ToneBadge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { LinkCard } from "@/components/ui/link-card";
import { Caption, Display, Text } from "@/components/ui/typography";
import { boardUrl } from "@/lib/config";
import { crisisTypes, type BoardCard, type PersonalViewCard } from "@/lib/spec";

/** The top ranked topic, drawn large on the home page. */
export function TopicHero({ topic }: { topic: BoardCard }) {
  const s = boardBadge(topic);
  return (
    <LinkCard href={boardUrl(topic.slug)} padding="lg" radius="xl" className="gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Caption>Top story now</Caption>
        <ToneBadge tone={s.tone}>
          {s.live ? <span aria-hidden="true" className="fd-live-dot" /> : null}
          {s.text}
        </ToneBadge>
        {topic.crisisType ? (
          <ToneBadge tone="neutral" mono>
            {topic.crisisType}
          </ToneBadge>
        ) : null}
        <Text as="span" size="sm" tone="muted" className="ml-auto">
          updated <Ago t={topic.updatedAt} />
        </Text>
      </div>
      <Display as="h2" size="md">
        {topic.title ?? "Untitled topic"}
      </Display>
      {topic.locationName ? <Text tone="muted">{topic.locationName}</Text> : null}
      {topic.headline ? (
        <Text size="lg" tone="subtle" className="max-w-4xl">
          {topic.headline}
        </Text>
      ) : null}
      {typeof topic.severity === "number" ? (
        <div className="w-56 max-w-full">
          <SeverityMeter value={topic.severity} />
        </div>
      ) : null}
    </LinkCard>
  );
}

const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Crisis type filter as links, so it works without JavaScript and keeps the page cacheable per type. */
export function TypeFilter({ base, active, extra = "" }: { base: string; active: string | null; extra?: string }) {
  const href = (t: string | null) => {
    const q = new URLSearchParams(extra);
    if (t) q.set("type", t);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const item = (t: string | null, label: string) => (
    <li key={t ?? "all"}>
      <Link
        href={href(t)}
        aria-current={active === t ? "page" : undefined}
        className={`inline-flex rounded-full border px-3 py-1 text-sm ${active === t ? "border-accent text-foreground" : "border-hairline text-muted-foreground hover:text-foreground"}`}
      >
        {label}
      </Link>
    </li>
  );
  return (
    <nav aria-label="Crisis type">
      <ul className="flex flex-wrap gap-2">
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
      <Text tone="muted">
        {compact ? "Open a topic and add it to your dashboards to shape it your way." : "You have no dashboards yet. Open a topic and choose Add to my dashboard."}
      </Text>
    );
  }
  return (
    <ul className={compact ? "flex gap-3 overflow-x-auto pb-1" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
      {views.map((v) => (
        <li key={v.id} className={compact ? "w-72 max-w-[80vw] shrink-0" : "min-w-0"}>
          <LinkCard href={`/me/${v.slug}`} padding="md" className="h-full gap-2">
            <div className="flex items-center gap-2">
              {v.changedSinceVisit ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-accent">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
                  New updates
                </span>
              ) : (
                <Text as="span" size="sm" tone="muted">
                  No news since your last visit
                </Text>
              )}
              <Text as="span" size="sm" tone="muted" className="ml-auto">
                <Ago t={v.updatedAt} />
              </Text>
            </div>
            <CardTitle as="h3">{v.title ?? "Untitled topic"}</CardTitle>
            {!compact && v.headline ? (
              <Text size="sm" tone="muted" className="line-clamp-2">
                {v.headline}
              </Text>
            ) : null}
          </LinkCard>
        </li>
      ))}
    </ul>
  );
}

export function EmptyTopics({ type }: { type: string | null }) {
  return (
    <Card padding="md">
      <Text tone="muted">
        {type ? `No ${type} topics right now.` : "No topics yet. Faraday scans the news every half hour and adds crises as they are confirmed."}
      </Text>
    </Card>
  );
}
