"use client";

import NextLink from "next/link";
import type { ReactNode } from "react";
import { Card, type CardProps } from "@sw3/ui";

type Props = { href: string; children: ReactNode; "aria-label"?: string } & Pick<CardProps, "padding" | "variant" | "radius" | "className">;

/** Stand-in: an sw3 Card is clickable only through onClick. This one is a real link, so it opens in a new tab and works before JS. */
export function LinkCard({ href, children, className, "aria-label": ariaLabel, ...card }: Props) {
  return (
    <NextLink href={href} data-fd="link-card" className="fd-link-card" aria-label={ariaLabel}>
      <Card interactive className={`h-full${className ? ` ${className}` : ""}`} {...card}>
        {children}
      </Card>
    </NextLink>
  );
}
