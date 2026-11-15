"use client";

import { useState, type ReactNode } from "react";
import { AppShell, AppShellHeader, AppShellInspector, AppShellSidebar, ShellToggle } from "@/components/ui/app-shell";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Heading } from "@/components/ui/typography";

type DataSection = { key: string; title: string; content: ReactNode };

type MapFocusProps = {
  boardId: string;
  title: string;
  status: ReactNode;
  actions: ReactNode;
  map: ReactNode;
  timeline?: ReactNode;
  overview: ReactNode;
  sections: DataSection[];
  sources?: ReactNode;
  changes?: ReactNode;
};

export function MapFocus({ boardId, title, status, actions, map, timeline, overview, sections, sources, changes }: MapFocusProps) {
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const activeSection = sections.find((item) => item.key === sectionKey) ?? sections[0];
  const selectedTab = (tab === "data" && !activeSection) || (tab === "sources" && !sources) || (tab === "changes" && !changes)
    ? "overview"
    : tab;
  return (
    <AppShell autoSaveId={`faraday-map-focus-${boardId}`} className="fd-map-focus @container" height="100%" collapseBelow={960} aria-label={title}>
      <AppShellHeader>
        <div className="flex w-full min-w-0 items-center gap-2">
          {timeline && <ShellToggle side="sidebar" label="Toggle timeline" />}
          <Heading as="h1" size="sm" title={title} className="min-w-0 flex-1 truncate">{title}</Heading>
          {status}
          {actions}
          <ShellToggle side="inspector" label="Toggle details" />
        </div>
      </AppShellHeader>
      {timeline && (
        <AppShellSidebar label="Incident timeline" header={<h2 className="text-sm font-semibold">Timeline</h2>}
          collapsible="offcanvas" defaultWidth={264} minWidth={220} maxWidth={400}>
          {timeline}
        </AppShellSidebar>
      )}
      <section className="fd-map-focus-stage" aria-label="Situation map">{map}</section>
      <AppShellInspector label="Board details" header={<h2 className="text-sm font-semibold">Details</h2>}
        defaultWidth={440} minWidth={340} maxWidth={660}>
        <Tabs value={selectedTab} onValueChange={setTab} size="sm" className="min-w-0 gap-0">
          <TabsList aria-label="Board details" className="overflow-x-auto px-3">
            <Tab value="overview">Overview</Tab>
            {activeSection && <Tab value="data">Data</Tab>}
            {sources && <Tab value="sources">Sources</Tab>}
            {changes && <Tab value="changes">Changes</Tab>}
          </TabsList>
          <TabsPanel className="fd-map-focus-pane" value="overview">{overview}</TabsPanel>
          {activeSection && (
            <TabsPanel className="fd-map-focus-pane" value="data" keepMounted>
              <Select aria-label="Data section" value={activeSection.key} onValueChange={setSectionKey} size="sm">
                <SelectTrigger className="fd-map-focus-data-title" title={activeSection.title} />
                <SelectContent>
                  {sections.map((section) => <SelectItem key={section.key} value={section.key}>{section.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <section key={activeSection.key} aria-label={activeSection.title}>{activeSection.content}</section>
            </TabsPanel>
          )}
          {sources && <TabsPanel className="fd-map-focus-pane" value="sources">{sources}</TabsPanel>}
          {changes && <TabsPanel className="fd-map-focus-pane" value="changes">{changes}</TabsPanel>}
        </Tabs>
      </AppShellInspector>
    </AppShell>
  );
}
