"use client";

import { useId, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";

import { BoardCardStack, type WorkspaceCard } from "./card-stack";
import { useLegacyWorkspacePanels, useWorkspaceSizes, type CornerWidth } from "./workspace-resize";
import { WorkspaceSidebar, type WorkspaceSidebarContent } from "./workspace-sidebar";

type Panel = { key: string; title: string; content: ReactNode; showsMapFigures?: boolean };
type WorkspaceProps = {
  workspaceKey?: string;
  cardsOnMap?: boolean;
  flowingDetails?: boolean;
  main?: ReactNode;
  defaultEvidenceOpen?: boolean;
  map?: ReactNode;
  mapFigures?: ReactNode;
  sidebar?: WorkspaceSidebarContent;
  overview: ReactNode;
  sections: Panel[];
  sources?: ReactNode;
  sourceCount: number;
  changes?: ReactNode;
  contextEvidence?: ReactNode;
  editor?: ReactNode;
  configuredCards?: WorkspaceCard[];
};

export function BoardWorkspace({ workspaceKey, cardsOnMap, flowingDetails, main, defaultEvidenceOpen, map, mapFigures, sidebar, overview, sections, sources, sourceCount, changes, contextEvidence, editor, configuredCards }: WorkspaceProps) {
  const id = useId();
  const overlay = Boolean(map && cardsOnMap);
  const legacy = useLegacyWorkspacePanels(workspaceKey);
  const resize = useWorkspaceSizes(workspaceKey, { timeline: legacy.sidebar?.width, details: legacy.inspector?.width });
  // Keep the saved width under its original browser storage key.
  const sidebarSize = resize("timeline");
  const detailsSize = resize("details");
  const [detailsOverride, setDetailsOpen] = useState<boolean>();
  const detailsOpen = detailsOverride ?? legacy.inspector?.open ?? true;
  const [wide, setWide] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "details" | null>(null);
  const detailsWidth: CornerWidth | undefined = map || main ? {
    measure: () => {
      const details = document.getElementById(`${id}-details`);
      const board = details?.parentElement;
      if (!details || !board || !getComputedStyle(details).getPropertyValue("--fd-workspace-details-min-width")) return null;

      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const room = Math.min(board.clientWidth * (overlay ? 0.48 : main ? 0.42 : 0.54), 46 * rem);
      const min = main ? 17 * rem : overlay ? Math.min(23 * rem, room) : 23 * rem;
      const max = Math.max(min, room);
      return { size: details.getBoundingClientRect().width, bounds: { min, max } };
    },
    onResize: detailsSize.onResize,
    onCommit: (size) => {
      setWide(false);
      detailsSize.onCommit(size);
    },
  } : undefined;
  const editing = !!editor;
  const [selection, setSelection] = useState({ tab: editing ? "layout" : "overview", editing });
  const [open, setOpen] = useState({ situation: true, evidence: defaultEvidenceOpen ?? false });
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  const [evidenceTab, setEvidenceTab] = useState<string | null>(null);
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  if (selection.editing !== editing) {
    setSelection({ editing, tab: editing ? "layout" : "overview" });
    if (editing) {
      setOpen({ ...open, situation: true });
      setDetailsOpen(true);
      if (map && !overlay) setMobilePanel("details");
    }
  }

  const activeSection = sections.find((section) => section.key === sectionKey) ?? sections[0];
  const situationTab = ((selection.tab === "layout" && editor) || (selection.tab === "data" && activeSection))
    ? selection.tab
    : "overview";
  const figuresOpen = !configuredCards && (overlay || detailsOpen) && open.situation && situationTab === "data" && activeSection?.showsMapFigures;
  const evidenceSources = configuredCards ? undefined : sources;
  const evidenceChanges = configuredCards ? undefined : changes;
  const evidenceTabs = [
    { value: "sources", label: "Sources", content: evidenceSources },
    { value: "changes", label: "Changes", content: evidenceChanges },
    { value: "context", label: "Context.dev", content: contextEvidence },
  ].filter((tab) => tab.content);
  const visibleEvidenceTab = evidenceTabs.find((tab) => tab.value === evidenceTab)?.value ?? evidenceTabs[0]?.value;
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
        {evidenceTabs.map(({ value, label }) => value === "sources"
          ? <Tab key={value} value={value} aria-label={`Sources, ${sourceCount}`}>Sources <span className="ml-1 text-xs text-muted-foreground">{sourceCount}</span></Tab>
          : <Tab key={value} value={value}>{label}</Tab>)}
      </TabsList>
      {evidenceTabs.map(({ value, content }) => <TabsPanel key={value} value={value} className="fd-workspace-tab-body">{content}</TabsPanel>)}
    </Tabs>
  );

  const evidenceCard = { id: "evidence" as const, label: "Evidence", content: evidence, open: open.evidence };
  const stackCards: ComponentProps<typeof BoardCardStack>["cards"] | undefined =
    configuredCards?.map((card) => ({ ...card, open: customOpen[card.id] ?? card.open }));
  if (stackCards && contextEvidence) stackCards.push(evidenceCard);
  if (stackCards && editor) stackCards.unshift({
    id: "card:layout-editor", label: "Edit layout", open: customOpen["card:layout-editor"] ?? true,
    content: <div className="fd-configured-card-content">{editor}</div>,
  });
  const cards = stackCards?.length === 0 ? null : (
    <BoardCardStack
      key={stackCards?.filter((card) => card.id !== "card:layout-editor").map((card) => card.id).join(",")}
      id={`${id}-detail-cards`}
      cards={stackCards ?? [
        { id: "situation", label: "Situation", content: situation, open: open.situation },
        ...(evidenceTabs.length ? [evidenceCard] : []),
      ]}
      onOpenChange={(name, value) => {
        if (name === "situation" || name === "evidence") setOpen((current) => ({ ...current, [name]: value }));
        else setCustomOpen((current) => ({ ...current, [name]: value }));
      }}
      resize={resize}
      detailsWidth={detailsWidth}
      flowing={flowingDetails && !overlay}
    />
  );
  const detailsStyle = detailsSize.value
    ? { "--fd-workspace-details-width": `${detailsSize.value}px` } as CSSProperties
    : undefined;
  const visibleMobilePanel = (overlay && mobilePanel === "details") || (!sidebar && mobilePanel === "sidebar") ? null : mobilePanel;

  return (
    <section className="fd-board-workspace" aria-label="Board workspace" data-has-map={map ? "" : undefined} data-has-main={main ? "" : undefined}
      data-mobile-panel={visibleMobilePanel ?? undefined} onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !(main && event.target instanceof Element && event.target.closest('[role="listbox"]'))) setMobilePanel(null);
      }}>
      {main && <div className="fd-workspace-mobile-tools fd-cyber-mobile-tools">
        {sidebar && <Button variant="secondary" size="sm" aria-controls={`${id}-sidebar`} aria-expanded={visibleMobilePanel === "sidebar"}
          onClick={() => setMobilePanel("sidebar")}>{sidebar.title}</Button>}
        <Button variant="secondary" size="sm" aria-controls={`${id}-details`} aria-expanded={visibleMobilePanel === "details"}
          onClick={() => setMobilePanel("details")}>Details</Button>
      </div>}
      {sidebar && <WorkspaceSidebar id={`${id}-sidebar`} size={sidebarSize}
        sidebar={{ ...sidebar, defaultOpen: sidebar.defaultOpen ?? legacy.sidebar?.open }}
        mobileOpen={visibleMobilePanel === "sidebar"}
        onMobileOpenChange={(open) => setMobilePanel(open ? "sidebar" : null)} />}

      {main && (
        <section className="fd-workspace-main" aria-label="Incident overview">
          <h2 className="text-sm font-semibold">Incident overview</h2>
          {main}
        </section>
      )}

      {map && <div className="fd-workspace-map" aria-label="Situation map" role="region"
        data-cards-on-map={overlay && cards ? "" : undefined} style={overlay ? detailsStyle : undefined}>
        {map}
        {!figuresOpen && mapFigures}
        {overlay && cards && (
          <div id={`${id}-details`} className="fd-workspace-map-cards" role="group" aria-label="Map cards">
            {cards}
          </div>
        )}
      </div>}

      {!overlay && <aside id={`${id}-details`} className="fd-workspace-details" aria-label="Board details" data-open={detailsOpen ? "" : undefined} data-wide={wide && !detailsSize.resizing ? "" : undefined}
        style={detailsStyle}>
        <div className="fd-workspace-panel-header fd-workspace-details-row">
          <h2 className="text-sm font-semibold">Details</h2>
          {(map || main) && detailsOpen && (
            <Button className="fd-workspace-desktop-action" size="sm" variant="ghost" iconOnly
              aria-label={wide ? "Restore details width" : "Widen details"}
              leading={<Icon name="expand" width={16} height={16} />} onClick={() => setWide((value) => !value)} />
          )}
          {(map || main) && (
            <Button className="fd-workspace-desktop-action" size="sm" variant="ghost" iconOnly
              aria-label={detailsOpen ? "Collapse details" : "Expand details"} aria-expanded={detailsOpen} aria-controls={`${id}-detail-cards`}
              leading={<Icon name={detailsOpen ? "chevron-right" : "chevron-left"} width={16} height={16} />}
              onClick={() => setDetailsOpen(!detailsOpen)} />
          )}
          {(map || main) && (
            <Button className="fd-workspace-details-mobile-action" size="sm" variant="ghost" iconOnly
              aria-label={mobilePanel === "details" ? "Close details" : "Open details"}
              aria-expanded={mobilePanel === "details"} aria-controls={`${id}-detail-cards`}
              leading={<Icon name={mobilePanel === "details" ? "chevron-right" : "chevron-left"} width={16} height={16} />}
              onClick={() => setMobilePanel(mobilePanel === "details" ? null : "details")} />
          )}
        </div>
        {cards}
      </aside>}
    </section>
  );
}
