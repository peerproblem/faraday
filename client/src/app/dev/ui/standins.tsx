"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { CitationChip } from "@/components/ui/citation";
import { Empty } from "@/components/ui/skeleton";
import { DataTable, type SortDirection } from "@/components/ui/table";
import { Caption, Text } from "@/components/ui/typography";

const rows = [
  { id: "r1", road: "GA-400 northbound", state: "Closed", since: "06:10" },
  { id: "r2", road: "I-85 at exit 113", state: "One lane", since: "07:45" },
  { id: "r3", road: "US-19 near Dahlonega", state: "Open", since: "09:20" },
];

export function StandinDemos() {
  const [dir, setDir] = useState<SortDirection>("none");
  const sorted = dir === "none" ? rows : [...rows].sort((a, b) => (dir === "ascending" ? 1 : -1) * a.road.localeCompare(b.road));
  return (
    <Card padding="md">
      <Caption>Citation chip</Caption>
      <Text>
        12,400 people have left their homes{" "}
        <CitationChip
          citation={{
            id: "s3",
            label: "Source s3: Georgia Emergency Management",
            title: "Evacuation update, 14 November",
            meta: "Georgia Emergency Management, official, published 2h ago",
            snippet: "Shelters in Hall and Lumpkin counties are open. Residents in low areas should leave now.",
            href: "https://example.org/evacuation-update",
          }}
        />
      </Text>
      <Caption>Table</Caption>
      <DataTable
        caption="Road closures"
        columns={[
          {
            key: "road",
            label: "Road",
            sort: {
              direction: dir,
              label: "Sort road closures by road",
              onToggle: () => setDir(dir === "none" ? "ascending" : dir === "ascending" ? "descending" : "none"),
            },
          },
          { key: "state", label: "State" },
          { key: "since", label: "Since", align: "end" },
        ]}
        rows={sorted.map((r) => ({ id: r.id, cells: { road: r.road, state: r.state, since: r.since } }))}
      />
      <Caption>Empty state</Caption>
      <Empty building={false}>No official advisories found in the sources.</Empty>
    </Card>
  );
}
