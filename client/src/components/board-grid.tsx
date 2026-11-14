import { Ago } from "@/components/ago";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { boardUrl } from "@/lib/config";
import type { BoardCard } from "@/lib/spec";

/** A board's state as a Badge: the variant, its text, and whether the dot pulses (a live, connected board). */
export function boardBadge(b: Pick<BoardCard, "status" | "tier">): { text: string; tone: BadgeVariant; live: boolean } {
  if (b.status === "error") return { text: "Error", tone: "danger", live: false };
  if (b.status !== "live") return { text: "Building", tone: "neutral", live: false };
  if (b.tier === "paused") return { text: "Paused", tone: "outline", live: false };
  return { text: "Live", tone: "success", live: true };
}

/** The badges at the top of a topic tile: its state and its crisis type. */
export function BoardBadges({ board }: { board: Pick<BoardCard, "status" | "tier" | "crisisType"> }) {
  const s = boardBadge(board);
  return (
    <>
      <Badge variant={s.tone} pulse={s.live}>
        {s.text}
      </Badge>
      {board.crisisType ? (
        <Badge variant="outline" mono>
          {board.crisisType}
        </Badge>
      ) : null}
    </>
  );
}

export function BoardGrid({
  boards,
  empty = "No topics yet",
  emptyDescription = "Faraday adds topics as crises are detected.",
}: {
  boards: BoardCard[];
  empty?: string;
  emptyDescription?: string;
}) {
  if (!boards.length) {
    return (
      <Card variant="muted" padding="lg">
        <EmptyState headingLevel={2} title={empty} description={emptyDescription} />
      </Card>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {boards.map((b) => (
        <li key={b.id} data-tier={b.tier} className="min-w-0">
          <Card href={boardUrl(b.slug)} aria-label={b.title ?? "Untitled topic"} padding="md" className="h-full gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <BoardBadges board={b} />
              <Text as="span" size="sm" tone="muted" className="ml-auto">
                <Ago t={b.updatedAt} />
              </Text>
            </div>
            <CardTitle as="h3">{b.title ?? "Untitled topic"}</CardTitle>
            {b.locationName ? (
              <Text size="sm" tone="muted">
                {b.locationName}
              </Text>
            ) : null}
            <Text size="sm" tone="muted" className="line-clamp-3">
              {b.headline ?? b.prompt}
            </Text>
          </Card>
        </li>
      ))}
    </ul>
  );
}
