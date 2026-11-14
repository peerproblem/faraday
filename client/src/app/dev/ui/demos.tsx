"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CitationChip } from "@/components/ui/citation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { Table, type TableRow } from "@/components/ui/table";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Timeline } from "@/components/ui/timeline";
import { Caption, Heading, Text } from "@/components/ui/typography";

const closures = [
  { id: "r1", road: "GA-400 northbound", state: "Closed", since: "06:10" },
  { id: "r2", road: "I-85 at exit 113", state: "One lane", since: "07:45" },
  { id: "r3", road: "US-19 near Dahlonega", state: "Open", since: "09:20" },
];
const rows: TableRow[] = closures.map((r) => ({ id: r.id, cells: { road: r.road, state: r.state, since: r.since } }));
const byId = new Map(closures.map((r) => [r.id, r]));

/** The interactive sw3 v2 parts Faraday uses, for checking an upgrade. */
export function Demos() {
  const [scope, setScope] = useState("all");
  const [loading, setLoading] = useState(true);
  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="flex flex-col gap-3">
        <Caption>Citation chip</Caption>
        <Text>
          12,400 people have left their homes{" "}
          <CitationChip
            reference="s3"
            title="Evacuation update, 14 November"
            publisher="Georgia Emergency Management"
            excerpt="Shelters in Hall and Lumpkin counties are open. Residents in low areas should leave now."
            href="https://example.org/evacuation-update"
          />
        </Text>
      </Card>

      <Card padding="md" className="flex flex-col gap-3">
        <Caption>Table with sorting</Caption>
        <Table
          caption="Road closures"
          columns={[
            { id: "road", label: "Road", rowHeader: true, compare: (a, b) => byId.get(a.id)!.road.localeCompare(byId.get(b.id)!.road) },
            { id: "state", label: "State" },
            { id: "since", label: "Since", align: "end", compare: (a, b) => byId.get(a.id)!.since.localeCompare(byId.get(b.id)!.since) },
          ]}
          rows={rows}
          emptyMessage="No closures reported"
        />
      </Card>

      <Card padding="md" className="flex flex-col gap-3">
        <Caption>Stat tones and timeline importance</Caption>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          <Stat label="Shelter occupancy" value="92%" delta="+8 pp" trend="up" tone="warning" warningLabel="Near capacity" />
          <Stat label="Power restored" value="71%" tone="success" />
          <Stat label="Deaths" value="14" tone="danger" />
        </div>
        <Timeline
          aria-label="Flood events"
          items={[
            { title: "River crests at 9.1 m", time: "06:00", importance: "high", status: "complete" },
            { title: "Shelters open in Hall County", time: "08:30", status: "current" },
            { title: "Next river gauge reading", time: "12:00", status: "upcoming" },
          ]}
        />
      </Card>

      <Card padding="md" className="flex flex-col gap-3">
        <Caption>Nested controls the agent bridge sees, and a marked action</Caption>
        <Tabs defaultValue="filters">
          <TabsList aria-label="Demo panels">
            <Tab value="filters">Filters</Tab>
            <Tab value="danger">Danger zone</Tab>
          </TabsList>
          <TabsPanel value="filters">
            <SegmentedControl
              aria-label="Scope"
              value={scope}
              onValueChange={setScope}
              options={[
                { value: "all", label: "All" },
                { value: "official", label: "Official" },
              ]}
            />
          </TabsPanel>
          <TabsPanel value="danger">
            <Button variant="danger" data-sw-confirm="">
              Delete forever
            </Button>
          </TabsPanel>
        </Tabs>
      </Card>

      <Card padding="md" className="flex flex-col gap-3">
        <Caption>Skeleton and empty state</Caption>
        <p role="status" className="sr-only">
          {loading ? "Loading summary" : "Summary loaded"}
        </p>
        <section aria-label="Summary" aria-busy={loading} className="flex flex-col gap-2">
          <Heading as="h3" size="sm" aria-hidden={loading || undefined}>
            {loading ? <Skeleton inline width="12ch" /> : "River levels"}
          </Heading>
          <Text size="sm">{loading ? <Skeleton inline width="32ch" /> : "The river crested at 9.1 m this morning and is falling."}</Text>
        </section>
        <div>
          <Button size="sm" variant="outline" onClick={() => setLoading(!loading)}>
            {loading ? "Show content" : "Show skeleton"}
          </Button>
        </div>
        <EmptyState title="No official advisories" description="None of the sources has issued an advisory yet." headingLevel={3} />
      </Card>
    </div>
  );
}
