import { notFound } from "next/navigation";
import { fixtureNames, getFixture } from "../../../../e2e/fixtures";
import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { SectionIntro } from "@/components/section-intro";
import { ToneBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextLink } from "@/components/ui/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, Text } from "@/components/ui/typography";
import type { BoardCard } from "@/lib/spec";
import { StandinDemos } from "./standins";

export const dynamic = "force-dynamic";

// Everything Faraday draws that is not a board: the shell pieces and the stand-ins for parts sw3 v1 lacks.
// Open it next to the same page on a new sw3 version to see what a migration changed. Never in production.
export default function UiGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  const cards: BoardCard[] = fixtureNames.map((name, i) => {
    const b = getFixture(name)!.board;
    return {
      id: b.id,
      slug: b.slug,
      title: b.data?.header.title ?? b.title,
      prompt: b.prompt,
      status: i === 2 ? "composing" : b.status,
      tier: i === 1 ? "paused" : b.tier,
      crisisType: b.data?.header.crisisType ?? null,
      headline: b.data?.header.headline?.text ?? null,
      updatedAt: b.updatedAt,
    } as BoardCard;
  });
  return (
    <>
      <PageIntro eyebrow="/dev/ui" title="Interface gallery" lede="Shell pieces and stand-ins, for checking a design system upgrade." />

      <SectionIntro title="Board cards" lede="Live, paused and building." />
      <BoardGrid boards={cards} />

      <SectionIntro title="Tones and actions" />
      <Card padding="md">
        <Caption>Badges</Caption>
        <div className="flex flex-wrap gap-2">
          <ToneBadge tone="neutral">Neutral</ToneBadge>
          <ToneBadge tone="accent">Accent</ToneBadge>
          <ToneBadge tone="success" dot>
            Success
          </ToneBadge>
          <ToneBadge tone="warning" dot>
            Warning (stand-in)
          </ToneBadge>
          <ToneBadge tone="danger" dot>
            Danger
          </ToneBadge>
          <ToneBadge tone="neutral" mono>
            Mono
          </ToneBadge>
        </div>
        <Caption>Buttons</Caption>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <Caption>Text link (stand-in)</Caption>
        <Text>
          A sentence with <TextLink href="/dev/ui">an internal link</TextLink> and{" "}
          <TextLink href="https://context.dev" external>
            an external one
          </TextLink>
          .
        </Text>
        <Caption>Skeleton (stand-in)</Caption>
        <Skeleton className="h-16" />
      </Card>

      <SectionIntro title="Stand-ins with behaviour" lede="Citation chip, table and empty state." />
      <StandinDemos />
    </>
  );
}
