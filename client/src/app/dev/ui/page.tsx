import { notFound } from "next/navigation";
import { fixtureNames, getFixture } from "../../../../e2e/fixtures";
import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { SectionIntro } from "@/components/section-intro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/components/ui/link";
import { Caption, Text } from "@/components/ui/typography";
import type { BoardCard } from "@/lib/spec";
import { Demos } from "./demos";

export const dynamic = "force-dynamic";

// Everything Faraday draws that is not a board: the shell pieces and the sw3 v2 parts it relies on.
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
      origin: "system",
      topicState: "active",
      rankScore: null,
      locationName: b.plan?.location?.name ?? null,
    } as BoardCard;
  });
  return (
    <>
      <PageIntro eyebrow="/dev/ui" title="Interface gallery" lede="Shell pieces and sw3 parts, for checking a design system upgrade." />

      <SectionIntro title="Board cards" lede="Live, paused and building." />
      <BoardGrid boards={cards} />

      <SectionIntro title="Tones and actions" />
      <Card padding="md" className="flex flex-col gap-3">
        <Caption>Badges</Caption>
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="success" pulse>
            Live
          </Badge>
          <Badge mono>Mono</Badge>
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
        <Caption>Text link</Caption>
        <Text>
          A sentence with <Link href="/dev/ui">an internal link</Link> and{" "}
          <Link href="https://context.dev" target="_blank" rel="noreferrer">
            an external one
          </Link>
          .
        </Text>
        <Caption>Card link</Caption>
        <Card href="/dev/fixtures/flood" padding="sm" variant="muted">
          <Text size="sm">The flood fixture board</Text>
        </Card>
      </Card>

      <SectionIntro title="Parts with behaviour" lede="Citation chip, table, tones, nested agent controls, skeleton and empty state." />
      <Demos />
    </>
  );
}
