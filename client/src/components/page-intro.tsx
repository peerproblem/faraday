import type { ReactNode } from "react";
import { Caption, Display, Text } from "@/components/ui/typography";

/** The top of a plain page: a mono eyebrow, the page's one Display, and an optional lede. */
export function PageIntro({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-8 pt-8 sm:pt-12">
      <Caption>{eyebrow}</Caption>
      <Display as="h1" size="md">
        {title}
      </Display>
      {lede ? (
        <Text size="lg" tone="subtle" className="max-w-2xl">
          {lede}
        </Text>
      ) : null}
    </header>
  );
}
