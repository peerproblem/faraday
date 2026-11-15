"use client";

import { useRouter } from "next/navigation";
import { ToggleGroup } from "@/components/ui/toggle";
import { topicFilters, type TopicFilter } from "@/lib/spec";

const categories = [
  { value: "all", label: "All" },
  ...topicFilters.map((type) => ({
    value: type,
    label: type === "natural-disasters" ? "Natural disasters" : type.charAt(0).toUpperCase() + type.slice(1),
  })),
];

export function CategoryFilter({ active, past }: { active: TopicFilter | null; past: boolean }) {
  const router = useRouter();

  return (
    <ToggleGroup
      aria-label="Topic categories"
      className="w-fit max-w-full"
      size="sm"
      items={categories}
      value={[active ?? "all"]}
      deselectable={false}
      onValueChange={([category]) => {
        if (!category) return;
        const params = new URLSearchParams();
        if (past) params.set("state", "archived");
        if (category !== "all") params.set("type", category);
        const query = params.toString();
        router.push(query ? `/topics?${query}` : "/topics", { scroll: false });
      }}
    />
  );
}
