"use client";

import { Text } from "@/components/ui/typography";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function NarrativeWidget({ data, sources, building }: WidgetProps<"narrative">) {
  const sentences = (data?.sentences ?? []).filter((s) => s && typeof s.text === "string" && s.text.trim());
  if (!sentences.length) return <Empty building={building}>No summary yet.</Empty>;
  return (
    <Text className="max-w-3xl">
      {sentences.map((s, i) => (
        <span key={`${i}-${s.text.slice(0, 24)}`}>
          {s.text} <SourceChips ids={s.sources} sources={sources} />{" "}
        </span>
      ))}
    </Text>
  );
}
