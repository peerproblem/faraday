"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { AppShell, AppShellHeader, AppShellInspector, AppShellSidebar, ShellToggle } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { useReorder } from "@/components/ui/reorder";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Squircle } from "@/components/ui/squircle";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Heading } from "@/components/ui/typography";
import { cardBounds, useWorkspaceSizes, WorkspaceResizeHandle } from "./workspace-resize";

type DataSection = { key: string; title: string; content: ReactNode };
type MapFocusProps = {
  boardId: string;
  title: string;
  status: ReactNode;
  actions: ReactNode;
  map: ReactNode;
  mapFigures?: ReactNode;
  timeline?: ReactNode;
  overview: ReactNode;
  sections: DataSection[];
  sources?: ReactNode;
  changes?: ReactNode;
};
const cardLabels = { situation: "Situation", evidence: "Evidence" };

export function MapFocus({ boardId, title, status, actions, map, mapFigures, timeline, overview, sections, sources, changes }: MapFocusProps) {
  const id = useId();
  const resize = useWorkspaceSizes(`personal:${boardId}`);
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>("overview");
  const [evidenceTab, setEvidenceTab] = useState<string | null>(null);
  const [open, setOpen] = useState({ situation: true, evidence: false });
  const [cardOrder, setCardOrder] = useState(["situation", "evidence"]);
  const activeSection = sections.find((item) => item.key === sectionKey) ?? sections[0];
  const hasEvidence = !!(sources || changes);
  const visibleCards = hasEvidence ? cardOrder : ["situation"];
  const reorder = useReorder({
    ids: visibleCards,
    onReorder: setCardOrder,
    disabled: !hasEvidence,
    getLabel: (key) => cardLabels[key as keyof typeof cardLabels],
  });

  const situation = (
    <Tabs value={tab === "data" && activeSection ? "data" : "overview"} onValueChange={setTab} size="sm" className="fd-map-focus-card-tabs">
      <TabsList aria-label="Situation views" className="shrink-0 overflow-x-auto px-3">
        <Tab value="overview">Overview</Tab>
        {activeSection && <Tab value="data">Data</Tab>}
      </TabsList>
      <TabsPanel className="fd-map-focus-pane fd-map-focus-overview" value="overview">{overview}</TabsPanel>
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
    </Tabs>
  );
  const evidence = (
    <Tabs value={evidenceTab === "changes" && changes ? "changes" : sources ? "sources" : "changes"} onValueChange={setEvidenceTab} size="sm" className="fd-map-focus-card-tabs">
      <TabsList aria-label="Evidence views" className="shrink-0 overflow-x-auto px-3">
        {sources && <Tab value="sources">Sources</Tab>}
        {changes && <Tab value="changes">Changes</Tab>}
      </TabsList>
      {sources && <TabsPanel className="fd-map-focus-pane" value="sources">{sources}</TabsPanel>}
      {changes && <TabsPanel className="fd-map-focus-pane" value="changes">{changes}</TabsPanel>}
    </Tabs>
  );

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
          collapsible="offcanvas" defaultWidth={264} minWidth={192} maxWidth={420}>
          {timeline}
        </AppShellSidebar>
      )}
      <section className="fd-map-focus-stage" aria-label="Situation map">
        {map}
        {mapFigures && <Squircle radius="lg" borderWidth={0} className="fd-map-focus-figures" role="region" aria-label="Map key figures">
          <div className="fd-map-focus-figures-body">{mapFigures}</div>
        </Squircle>}
      </section>
      <AppShellInspector label="Board details" header={<h2 className="text-sm font-semibold">Details</h2>}
        defaultWidth={440} minWidth={340} maxWidth={660}>
        <div {...reorder.getContainerProps()} className="fd-map-focus-card-stack">
          {visibleCards.map((key, index) => {
            const name = key as keyof typeof cardLabels;
            const cardId = `${id}-${name}`;
            const size = resize(name);
            const edge = index === 0 ? "end" : "start";
            return (
              <Card key={name} {...reorder.getItemProps(name)} id={cardId} radius="lg" padding="none" bordered role="region" aria-label={cardLabels[name]}
                className="fd-map-focus-detail-card" data-open={open[name] ? "" : undefined} data-resize-edge={edge}
                data-fixed-height={size.value ? "" : undefined}
                style={size.value ? { "--fd-workspace-card-height": `${size.value}px` } as CSSProperties : undefined}>
                <Collapsible open={open[name]} onOpenChange={(value) => setOpen((current) => ({ ...current, [name]: value }))}
                  keepMounted={name === "situation"} className="fd-map-focus-card-fold">
                  <div className="fd-map-focus-card-header">
                    {hasEvidence && <Button {...reorder.getHandleProps(name)} variant="ghost" size="sm"
                      className="shrink-0 cursor-grab touch-none" iconOnly title={`Reorder ${cardLabels[name]}`}
                      leading={<Icon name="grip" width={16} height={16} />} />}
                    <h3 className="min-w-0 flex-1 text-sm font-semibold">
                      <CollapsibleTrigger className="w-full justify-between px-1">{cardLabels[name]}</CollapsibleTrigger>
                    </h3>
                  </div>
                  <CollapsiblePanel className="fd-map-focus-card-body">{name === "situation" ? situation : evidence}</CollapsiblePanel>
                </Collapsible>
                {open[name] && <WorkspaceResizeHandle {...size} target={cardId} label={`Resize ${cardLabels[name]} height`}
                  edge={edge} getBounds={cardBounds} />}
              </Card>
            );
          })}
          {reorder.dropIndicator}
          {reorder.overlay}
        </div>
      </AppShellInspector>
    </AppShell>
  );
}
