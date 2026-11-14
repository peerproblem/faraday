"use client";

import { Card } from "@/components/ui/card";
import { Link } from "@/components/ui/link";
import { Caption, Text } from "@/components/ui/typography";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function LinkListWidget({ data, sources, building }: WidgetProps<"link-list">) {
  const items = (data?.items ?? []).filter((h) => h && typeof h.id === "string" && /^https?:\/\//.test(h.url ?? ""));
  if (!items.length) return <Empty building={building} title="No help resources" description="The sources do not list hotlines, shelters or donation pages yet." />;
  return (
    <ul className="grid gap-3">
      {items.map((h) => (
        <li key={h.id} className="min-w-0">
          <Card variant="muted" padding="sm" className="gap-1.5">
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
          </Card>
        </li>
      ))}
    </ul>
  );
}
