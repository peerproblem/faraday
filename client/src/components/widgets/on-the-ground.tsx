"use client";

import { Text } from "@/components/ui/typography";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function OnTheGroundWidget({ data, sources, building }: WidgetProps<"on-the-ground">) {
  if (!data?.items.length) return <Empty building={building} title="No unverified reports" description="Social posts from the area appear here, marked as unverified." />;
  return (
    <div className="flex flex-col gap-3">
      <Text size="sm" tone="muted">Unverified social reports. These claims have not been confirmed by official or news sources.</Text>
      <ul className="divide-y divide-hairline">
        {data.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 py-3">
            <Text size="sm">{item.quote}</Text>
            <SourceChips ids={item.sources} sources={sources} />
          </li>
        ))}
      </ul>
    </div>
  );
}
