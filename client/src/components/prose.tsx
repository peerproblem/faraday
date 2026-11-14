import type { ReactNode } from "react";
import { Heading, Text } from "@/components/ui/typography";

/** Long-form copy for the legal pages: one readable column. */
export function Prose({ children }: { children: ReactNode }) {
  return <article className="flex max-w-2xl flex-col gap-4">{children}</article>;
}

export function ProseHeading({ children }: { children: ReactNode }) {
  return (
    <Heading as="h2" size="sm" className="mt-6">
      {children}
    </Heading>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <Text tone="subtle">{children}</Text>;
}
