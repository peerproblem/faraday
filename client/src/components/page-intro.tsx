import type { ReactNode } from "react";
import { Caption, Display, Heading, Text } from "@/components/ui/typography";

/**
 * The top of a plain page: a mono eyebrow, the page's one h1 and an optional lede. The home page is the hero and
 * gets the Display; every other page title is a Heading, as the typography guide asks.
 */
export function PageIntro({ eyebrow, title, lede, hero = false }: { eyebrow: string; title: string; lede?: ReactNode; hero?: boolean }) {
  return (
    <header className="flex flex-col gap-4 pb-8 pt-8 sm:pt-12">
      <Caption>{eyebrow}</Caption>
      {hero ? (
        <Display as="h1" size="md">
          {title}
        </Display>
      ) : (
        <Heading as="h1" size="lg">
          {title}
        </Heading>
      )}
      {lede ? (
        <Text size="lg" tone="subtle" className="max-w-2xl">
          {lede}
        </Text>
      ) : null}
    </header>
  );
}
