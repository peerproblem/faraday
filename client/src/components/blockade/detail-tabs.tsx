"use client";

import type { ReactNode } from "react";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";

const tabs = [
  { value: "maritime", label: "Sea" },
  { value: "borders", label: "Borders" },
  { value: "advisories", label: "Advisories" },
  { value: "evidence", label: "Evidence" },
] as const;

type TabValue = (typeof tabs)[number]["value"];

/** The Details panel: one tab per part of the blockade, each with its record count. */
export function DetailTabs({ counts, ...panels }: Record<TabValue, ReactNode> & { counts: Partial<Record<TabValue, number>> }) {
  return (
    <Tabs defaultValue="maritime" size="sm" className="fd-workspace-tabs">
      <TabsList aria-label="Blockade records" className="fd-workspace-tab-list">
        {tabs.map(({ value, label }) => (
          <Tab key={value} value={value} aria-label={counts[value] === undefined ? label : `${label}, ${counts[value]}`}>
            {label}
            {counts[value] !== undefined && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{counts[value]}</span>}
          </Tab>
        ))}
      </TabsList>
      {tabs.map(({ value }) => (
        <TabsPanel key={value} value={value} className="fd-workspace-tab-body fd-blockade-panel">{panels[value]}</TabsPanel>
      ))}
    </Tabs>
  );
}
