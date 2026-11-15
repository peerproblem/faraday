"use client";

import { Link } from "@/components/ui/link";
import { Caption, Text } from "@/components/ui/typography";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function LinkListWidget({ data, sources, building, mapFocus }: WidgetProps<"link-list">) {
  const items = (data?.items ?? []).filter((h) => h && (!mapFocus || h.kind !== "official") && typeof h.id === "string" && /^https?:\/\//.test(h.url ?? ""));
  if (!items.length) return <Empty building={building} title="No help resources" description="The sources do not list hotlines, shelters or donation pages yet." />;
  return (
    // Rows on hairlines inside the tile, no cards of their own: the tile is the frame.
    <ul className="grid divide-y divide-hairline">
      {items.map((h) => (
        <li key={h.id} className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
            <Caption>{h.kind}</Caption>
            <Text>
              <Link href={h.url} target="_blank" rel="noreferrer">
                {h.label}
              </Link>
            </Text>
            {h.note ? (
              <Text size="sm" tone="subtle">
                {h.note}
              </Text>
            ) : null}
            <SourceChips ids={h.sources} sources={sources} />
        </li>
      ))}
    </ul>
  );
}
