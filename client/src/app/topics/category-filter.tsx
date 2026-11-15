"use client";

import { useRouter } from "next/navigation";
import { ToggleGroup } from "@/components/ui/toggle";
import { crisisTypes, type CrisisType } from "@/lib/spec";

const categories = [
  { value: "all", label: "All" },
  ...crisisTypes.map((type) => ({ value: type, label: type.charAt(0).toUpperCase() + type.slice(1) })),
];

export function CategoryFilter({ active, past }: { active: CrisisType | null; past: boolean }) {
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
