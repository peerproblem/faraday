"use client";

import { designLimits } from "@/components/ui/meta";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

export function NarrativeWidget({ data, sources, building, collapseSourceGroups }: WidgetProps<"narrative">) {
  const sentences = (data?.sentences ?? []).filter((s) => s && typeof s.text === "string" && s.text.trim());
  if (!sentences.length) return <Empty building={building} title="No summary yet" />;
  return (
    // sw3's measure for running text: a lede no wider than ledeWidthRem.
    <Text style={{ maxWidth: `${designLimits.ledeWidthRem.recommendedMax}rem` }}>
      {sentences.map((s, i) => (
        <span key={`${i}-${s.text.slice(0, 24)}`}>
          {s.text} <SourceChips ids={s.sources} sources={sources} collapseAt={collapseSourceGroups ? 5 : undefined} />{" "}
        </span>
      ))}
    </Text>
  );
}
