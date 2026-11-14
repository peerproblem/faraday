import { Ago } from "@/components/ago";
import { ToneBadge, type Tone } from "@/components/ui/badge";
import { CardTitle } from "@/components/ui/card";
import { LinkCard } from "@/components/ui/link-card";
import { Text } from "@/components/ui/typography";
import { boardUrl } from "@/lib/config";
import type { BoardCard } from "@/lib/spec";

export function boardBadge(b: Pick<BoardCard, "status" | "tier">): { text: string; tone: Tone; live: boolean } {
  if (b.status === "error") return { text: "Error", tone: "danger", live: false };
  if (b.status !== "live") return { text: "Building", tone: "accent", live: false };
  if (b.tier === "paused") return { text: "Paused", tone: "neutral", live: false };
  return { text: "Live", tone: "success", live: true };
}

export function BoardGrid({ boards, empty = "No topics yet. Faraday adds them as crises are detected." }: { boards: BoardCard[]; empty?: string }) {
  if (!boards.length) {
    return <Text tone="muted">{empty}</Text>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {boards.map((b) => {
        const s = boardBadge(b);
        return (
          <li key={b.id} data-tier={b.tier} className="min-w-0">
            <LinkCard href={boardUrl(b.slug)} padding="md" className="gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={s.tone}>
                  {s.live ? <span aria-hidden="true" className="fd-live-dot" /> : null}
                  {s.text}
                </ToneBadge>
                {b.crisisType ? (
                  <ToneBadge tone="neutral" mono>
                    {b.crisisType}
                  </ToneBadge>
                ) : null}
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
            </LinkCard>
          </li>
        );
      })}
    </ul>
  );
}
