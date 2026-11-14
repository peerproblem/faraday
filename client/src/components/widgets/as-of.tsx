"use client";

import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/typography";
import { isStale } from "@/lib/time";

/** "as of 3h ago", with a Stale badge when a live board's figure is more than a day old (guide P4-5). */
export function AsOf({ t, tier, prefix = "as of" }: { t: string | null | undefined; tier: string; prefix?: string }) {
  if (!t) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Text as="span" size="sm" tone="muted">
        {prefix} <Ago t={t} />
      </Text>
      {isStale(t, tier) ? (
        <Badge variant="warning" title="This figure is more than a day old">
          Stale
        </Badge>
      ) : null}
    </span>
  );
}
