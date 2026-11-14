"use client";

import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger, Text } from "@sw3/ui";
import { TextLink } from "./link";

export type Citation = {
  /** Short id shown on the chip, like "s3". */
  id: string;
  /** Accessible name of the chip; it should say which source this is. */
  label: string;
  title: string;
  meta: ReactNode;
  snippet?: string | null;
  href: string;
};

/** Stand-in: a small mono chip that opens the source in an sw3 Popover. sw3 v1 has no chip-sized trigger. */
export function CitationChip({ citation: c }: { citation: Citation }) {
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" data-fd="cite" className="fd-cite" aria-label={c.label} />}>{c.id}</PopoverTrigger>
      <PopoverContent side="top" padding="sm">
        <PopoverTitle>{c.title}</PopoverTitle>
        <PopoverDescription>{c.meta}</PopoverDescription>
        {c.snippet ? (
          <Text size="sm" tone="muted" className="line-clamp-5">
            {c.snippet}
          </Text>
        ) : null}
        <Text size="sm" className="truncate">
          <TextLink href={c.href} external>
            {c.href}
          </TextLink>
        </Text>
      </PopoverContent>
    </Popover>
  );
}
