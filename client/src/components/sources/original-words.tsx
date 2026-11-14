"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

/**
 * A source's own words in its own language, folded away under the English translation. The board reads in
 * English; the original is one press away for anyone who wants to check the translation against it.
 */
export function OriginalWords({ original }: { original: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide original" : "Show original"}
      </Button>
      {open ? (
        <blockquote id={id} className="fd-excerpt" translate="no">
          <Text size="sm" tone="muted">
            {original}
          </Text>
        </blockquote>
      ) : null}
    </div>
  );
}
