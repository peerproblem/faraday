"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { useReorder } from "@/components/ui/reorder";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";

import { cardBounds, timelineBounds, useWorkspaceSizes, WorkspaceResizeHandle, type CornerWidth } from "./workspace-resize";

type Panel = { key: string; title: string; content: ReactNode; showsMapFigures?: boolean };
type WorkspaceProps = {
  workspaceKey?: string;
  map?: ReactNode;
  mapFigures?: ReactNode;
  timeline?: ReactNode;
  overview: ReactNode;
  sections: Panel[];
  sources?: ReactNode;
  sourceCount: number;
  changes?: ReactNode;
  editor?: ReactNode;
};

export function BoardWorkspace({ workspaceKey, map, mapFigures, timeline, overview, sections, sources, sourceCount, changes, editor }: WorkspaceProps) {
  const id = useId();
  const resize = useWorkspaceSizes(workspaceKey);
  const timelineSize = resize("timeline");
  const detailsSize = resize("details");
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [wide, setWide] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"timeline" | "details" | null>(null);
  const detailsWidth: CornerWidth | undefined = map ? {
    measure: () => {
      const details = document.getElementById(`${id}-details`);
      const board = details?.parentElement;
      if (!details || !board || !getComputedStyle(details).getPropertyValue("--fd-workspace-details-min-width")) return null;

      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const min = 23 * rem;
      const max = Math.max(min, Math.min(board.clientWidth * 0.54, 46 * rem));
      return { size: details.offsetWidth, bounds: { min, max } };
    },
    onResize: detailsSize.onResize,
    onCommit: (size) => {
      setWide(false);
      detailsSize.onCommit(size);
    },
  } : undefined;
  const editing = !!editor;
  const [selection, setSelection] = useState({ tab: editing ? "layout" : "overview", editing });
  const [open, setOpen] = useState({ situation: true, evidence: false });
  const [cardOrder, setCardOrder] = useState(["situation", "evidence"]);
  const [evidenceTab, setEvidenceTab] = useState<string | null>(null);
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  if (selection.editing !== editing) {
    setSelection({ editing, tab: editing ? "layout" : "overview" });
    if (editing) {
      setOpen({ ...open, situation: true });
      setDetailsOpen(true);
      if (map) setMobilePanel("details");
    }
  }

  const activeSection = sections.find((section) => section.key === sectionKey) ?? sections[0];
  const situationTab = ((selection.tab === "layout" && editor) || (selection.tab === "data" && activeSection))
    ? selection.tab
    : "overview";
  const figuresOpen = detailsOpen && open.situation && situationTab === "data" && activeSection?.showsMapFigures;
  const hasEvidence = !!(sources || changes);
  const visibleEvidenceTab = evidenceTab === "changes" && changes ? "changes" : sources ? "sources" : "changes";
  const cardLabels = { situation: "Situation", evidence: "Evidence" };
  const reorder = useReorder({
    ids: hasEvidence ? cardOrder : ["situation"],
    onReorder: setCardOrder,
    disabled: !hasEvidence,
    getLabel: (key) => cardLabels[key as keyof typeof cardLabels],
  });

  const situation = (
    <Tabs value={situationTab} onValueChange={(tab) => setSelection({ tab, editing })} size="sm" className="fd-workspace-tabs">
      <TabsList aria-label="Situation views" className="fd-workspace-tab-list">
        <Tab value="overview">Overview</Tab>
        {activeSection && <Tab value="data">Data</Tab>}
        {editor && <Tab value="layout">Layout</Tab>}
      </TabsList>
      <TabsPanel value="overview" className="fd-workspace-tab-body fd-workspace-overview">{overview}</TabsPanel>
      {activeSection && (
        <TabsPanel value="data" className="fd-workspace-tab-body" keepMounted>
          <Select aria-label="Data section" value={activeSection.key} onValueChange={setSectionKey} size="sm">
            <SelectTrigger title={activeSection.title} className="w-full min-w-0" />
            <SelectContent>
              {sections.map((section) => <SelectItem key={section.key} value={section.key}>{section.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <div key={activeSection.key} className="min-w-0">{activeSection.content}</div>
        </TabsPanel>
      )}
      {editor && <TabsPanel value="layout" className="fd-workspace-tab-body">{editor}</TabsPanel>}
    </Tabs>
  );

  const evidence = (
    <Tabs value={visibleEvidenceTab} onValueChange={setEvidenceTab} size="sm" className="fd-workspace-tabs">
      <TabsList aria-label="Evidence views" className="fd-workspace-tab-list">
        {sources && <Tab value="sources" aria-label={`Sources, ${sourceCount}`}>Sources <span className="ml-1 text-xs text-muted-foreground">{sourceCount}</span></Tab>}
        {changes && <Tab value="changes">Changes</Tab>}
      </TabsList>
      {sources && <TabsPanel value="sources" className="fd-workspace-tab-body">{sources}</TabsPanel>}
      {changes && <TabsPanel value="changes" className="fd-workspace-tab-body">{changes}</TabsPanel>}
    </Tabs>
  );

  return (
    <section className="fd-board-workspace" aria-label="Board workspace" data-has-map={map ? "" : undefined}
      data-mobile-panel={mobilePanel ?? undefined} onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) setMobilePanel(null);
      }}>
      {(map || timeline) && (
        <div className="fd-workspace-mobile-tools">
          {timeline && <Button variant="secondary" size="sm" aria-controls={`${id}-timeline`} aria-expanded={mobilePanel === "timeline"} onClick={() => setMobilePanel("timeline")}>Timeline</Button>}
          {map && <Button variant="secondary" size="sm" aria-controls={`${id}-details`} aria-expanded={mobilePanel === "details"} onClick={() => setMobilePanel("details")}>Details</Button>}
        </div>
      )}

      {timeline && (
        <aside id={`${id}-timeline`} className="fd-workspace-timeline" aria-label="Incident timeline" data-open={timelineOpen ? "" : undefined}
          style={timelineSize.value ? { "--fd-workspace-timeline-width": `${timelineSize.value}px` } as CSSProperties : undefined}>
          <div className="fd-workspace-panel-header">
            <h2 className="text-sm font-semibold">Timeline</h2>
            <Button className="fd-workspace-desktop-action" size="sm" variant="ghost" iconOnly
              aria-label={timelineOpen ? "Collapse timeline" : "Expand timeline"} aria-expanded={timelineOpen} aria-controls={`${id}-timeline-content`}
              leading={<Icon name={timelineOpen ? "chevron-left" : "chevron-right"} width={16} height={16} />}
              onClick={() => setTimelineOpen((open) => !open)} />
            <Button className="fd-workspace-close" size="sm" variant="ghost" iconOnly aria-label="Close timeline"
              leading={<Icon name="close" width={16} height={16} />} onClick={() => setMobilePanel(null)} />
          </div>
          <div id={`${id}-timeline-content`} className="fd-workspace-timeline-content">
            {timeline}
          </div>
          {timelineOpen && <WorkspaceResizeHandle {...timelineSize} target={`${id}-timeline`} label="Resize timeline width"
            axis="width" getBounds={timelineBounds} />}
        </aside>
      )}

      {map && <div className="fd-workspace-map" aria-label="Situation map" role="region">{map}
        {!figuresOpen && mapFigures}
      </div>}

      <aside id={`${id}-details`} className="fd-workspace-details" aria-label="Board details" data-open={detailsOpen ? "" : undefined} data-wide={wide && !detailsSize.resizing ? "" : undefined}
        style={detailsSize.value ? { "--fd-workspace-details-width": `${detailsSize.value}px` } as CSSProperties : undefined}>
        <div className="fd-workspace-panel-header">
          <h2 className="text-sm font-semibold">Details</h2>
          {map && detailsOpen && (
            <Button className="fd-workspace-desktop-action" size="sm" variant="ghost" iconOnly
              aria-label={wide ? "Restore details width" : "Widen details"}
              leading={<Icon name="expand" width={16} height={16} />} onClick={() => setWide((value) => !value)} />
          )}
          {map && (
            <Button className="fd-workspace-desktop-action" size="sm" variant="ghost" iconOnly
              aria-label={detailsOpen ? "Collapse details" : "Expand details"} aria-expanded={detailsOpen} aria-controls={`${id}-detail-cards`}
              leading={<Icon name={detailsOpen ? "chevron-right" : "chevron-left"} width={16} height={16} />}
              onClick={() => setDetailsOpen((value) => !value)} />
          )}
          <Button className="fd-workspace-close" size="sm" variant="ghost" iconOnly aria-label="Close details"
            leading={<Icon name="close" width={16} height={16} />} onClick={() => setMobilePanel(null)} />
        </div>
        <div {...reorder.getContainerProps()} id={`${id}-detail-cards`} className="fd-workspace-card-stack">
          {cardOrder.filter((key) => key !== "evidence" || hasEvidence).map((key, index) => {
            const name = key as keyof typeof cardLabels;
            const label = cardLabels[name];
            const cardId = `${id}-${name}`;
            const cardSize = resize(name);
            const resizeEdge = index === 0 ? "end" : "start";
            return (
              <Card key={name} {...reorder.getItemProps(name)} id={cardId} role="region" aria-label={label}
                radius="lg" padding="none" bordered className="fd-workspace-detail-card" data-open={open[name] ? "" : undefined}
                data-fixed-height={cardSize.value ? "" : undefined} data-resize-edge={resizeEdge}
                style={cardSize.value ? { "--fd-workspace-card-height": `${cardSize.value}px` } as CSSProperties : undefined}>
                <Collapsible open={open[name]} onOpenChange={(value) => setOpen((current) => ({ ...current, [name]: value }))}
                  keepMounted={name === "situation"} className="fd-workspace-card-fold">
                  <div className="fd-workspace-card-header">
                    {/* The 24px grip sits 8px inside the card's 20px corners. */}
                    {hasEvidence && <Button {...reorder.getHandleProps(name)} variant="ghost" size="sm" radius={12}
                      className="size-[var(--sw-space-6)] shrink-0 cursor-grab touch-none" iconOnly title={`Reorder ${label}`}
                      leading={<Icon name="grip" width={16} height={16} />} />}
                    <h3 className="min-w-0 flex-1 text-sm font-semibold">
                      <CollapsibleTrigger className="mx-0 w-full justify-between px-1">{label}</CollapsibleTrigger>
                    </h3>
                  </div>
                  <CollapsiblePanel className="fd-workspace-card-body">
                    {name === "situation" ? situation : evidence}
                  </CollapsiblePanel>
                </Collapsible>
                {open[name] && <WorkspaceResizeHandle {...cardSize} target={cardId} label={`Resize ${label} card`}
                  axis="height" edge={resizeEdge} getBounds={cardBounds} cornerWidth={detailsWidth} />}
              </Card>
            );
          })}
          {reorder.dropIndicator}
          {reorder.overlay}
        </div>
      </aside>
    </section>
  );
}
