"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Board, isBuilding, visibleWidgets } from "@/components/board/board";
import { BoardHeaderButton } from "@/components/board/header-button";
import { BoardToasts, useLiveBoard } from "@/components/board/live-board";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { Heading, Text } from "@/components/ui/typography";
import { applyLayout, moveKey, settleLayout, type LaidOutWidget } from "@/lib/client/apply-layout";
import { useLayout } from "@/lib/client/use-layout";
import { ApiError, editView, removeView, undoView } from "@/lib/client/views-api";
import { boardUrl } from "@/lib/config";
import { emptyLayout, widgetKeyOf, type BoardView, type CrisisType, type MapPointKind, type PersonalLayout, type PersonalViewState, type SourceType, type TableData, type WidgetFilter } from "@/lib/spec";

const monitorCategories = new Set<CrisisType>(["flood", "wildfire", "earthquake", "storm", "heatwave", "conflict"]);

const MIN_INSTRUCTION = 3;
const MAX_INSTRUCTION = 500;
/** How long New badges stay before the layout is saved as seen. */
const SEEN_AFTER_MS = 8000;

type Importance = "all" | "medium" | "high";
const importanceOptions: { value: Importance; label: string }[] = [
  { value: "all", label: "All" },
  { value: "medium", label: "Notable" },
  { value: "high", label: "Major" },
];

type Places = "all" | "impact" | "help";
const placeKinds: Record<Exclude<Places, "all">, MapPointKind[]> = {
  impact: ["impact", "incident", "origin", "closure"],
  help: ["shelter", "resource"],
};
const placeOptions: { value: Places; label: string }[] = [
  { value: "all", label: "All places" },
  { value: "impact", label: "Impact" },
  { value: "help", label: "Help" },
];

type Coverage = "all" | "official" | "news";
const coverageOptions: { value: Coverage; label: string }[] = [
  { value: "all", label: "All" },
  { value: "official", label: "Official" },
  { value: "news", label: "News" },
];

function placesOf(f: WidgetFilter | undefined): Places {
  if (f?.kind !== "map") return "all";
  if (f.pointKinds.every((k) => placeKinds.help.includes(k))) return "help";
  return "impact";
}

/** The shared baseline plus this person's layout. Layout changes glide; data updates only highlight. */
export function PersonalBoard({
  initial,
  initialView,
  live = true,
  localPreview = false,
  workspaceNavigation,
}: {
  initial: BoardView;
  initialView: PersonalViewState | null;
  /** False renders a saved board without the stream (dev fixtures). */
  live?: boolean;
  localPreview?: boolean;
  workspaceNavigation?: ReactNode;
}) {
  const router = useRouter();
  const { board, partial, spec, data, connected, refresh, updatedAt } = useLiveBoard(initial, { live });
  const { layout, saving, change, replace, saveNow } = useLayout(board.id, initialView, localPreview);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<{ text: string; unsupported: string[] } | null>(null);
  const [busy, setBusy] = useState<"undo" | "remove" | null>(null);

  const current: PersonalLayout = useMemo(() => layout ?? emptyLayout(board.version), [layout, board.version]);
  const full = useMemo(() => (spec ? applyLayout(spec, data, current, { version: board.version }) : null), [spec, data, current, board.version]);

  const commit = (next: PersonalLayout) => {
    if (!spec) return;
    change(settleLayout(spec, data, next, board.version));
  };

  // New sections keep their badge for a moment, then the layout is saved as seen.
  const hasNew = !!layout && !!full?.widgets.some((w) => w.isNew);
  useEffect(() => {
    if (!hasNew || !spec) return;
    const t = setTimeout(() => change(settleLayout(spec, data, current, board.version)), SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [hasNew, spec, data, current, board.version, change]);

  const available = visibleWidgets(spec, data, isBuilding(board.status));
  const hasMap = board.specVersion >= 2 && available.some((w) => w.type === "map");
  const crisisType = data?.header?.crisisType;
  const finance = spec?.template === "finance";
  const standardLabel = finance ? "Finance dashboard" : "Standard dashboard";
  const recommendMonitor = hasMap && !finance && !!crisisType && monitorCategories.has(crisisType);
  const mapDesign = !finance && (current.design === "map-focus" || current.design === "map-overlay");
  const workspace = hasMap && mapDesign && available.some((w) =>
    w.type === "map" && !current.hidden.includes(widgetKeyOf(w)),
  );
  const hiddenWidgets = (spec?.widgets ?? []).filter((w) => current.hidden.includes(widgetKeyOf(w)));
  const chartTables = available.filter((widget) => {
    if (widget.type !== "table" || current.hidden.includes(widgetKeyOf(widget))) return false;
    const table = data?.widgets[widget.id] as TableData | undefined;
    return table?.columns.some((column) => column.kind === "status");
  });
  const chartWidget = chartTables.find((widget) => widgetKeyOf(widget) === current.overviewChart?.widget);
  const editAction = (
    <Button size="xs" variant={editing ? "primary" : "outline"} className="shrink-0"
      onClick={() => setEditing((value) => !value)}>
      {editing ? "Done editing" : "Edit layout"}
    </Button>
  );

  async function sendEdit() {
    const text = instruction.trim();
    if (sending || text.length < MIN_INSTRUCTION) return;
    setSending(true);
    setReply(null);
    try {
      await saveNow();
      const r = await editView(board.id, text);
      replace(r.layout, r.rev);
      setReply({ text: r.reply, unsupported: r.unsupported ?? [] });
      setInstruction("");
    } catch (e) {
      toast.danger("Could not change your dashboard", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function undo() {
    if (busy) return;
    setBusy("undo");
    try {
      await saveNow();
      const r = await undoView(board.id);
      replace(r.layout, r.rev);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) toast("Nothing to undo");
      else toast.danger("Could not undo", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy("remove");
    try {
      await removeView(board.id);
      router.push("/me");
    } catch (e) {
      toast.danger("Could not remove it", { description: (e as Error).message });
      setBusy(null);
    }
  }

  const setFilter = (key: string, f: WidgetFilter | null) => {
    const filters = { ...current.filters };
    if (f) filters[key] = f;
    else delete filters[key];
    commit({ ...current, filters });
  };

  const tools = (lw: LaidOutWidget) => {
    if (!editing || !full) return null;
    const k = lw.key;
    const featured = (type: LaidOutWidget["widget"]["type"]) =>
      workspace && (type === "map" || type === "changelog" || type === "sources" || type === "timeline");
    const reorderable = { ...full, widgets: full.widgets.filter(({ widget }) => !featured(widget.type)) };
    const order = reorderable.widgets.filter((w) => !w.pinned).map((w) => w.key);
    const i = order.indexOf(k);
    const t = lw.widget.title;
    return (
      <>
        <FilterControl lw={lw} onChange={(f) => setFilter(k, f)} />
        {!featured(lw.widget.type) ? <>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Move ${t} up`}
          disabled={lw.pinned || i <= 0}
          onClick={() => commit({ ...current, order: moveKey(reorderable, k, -1) })}
        >
          <Icon name="chevron-up" width={16} height={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Move ${t} down`}
          disabled={lw.pinned || i < 0 || i >= order.length - 1}
          onClick={() => commit({ ...current, order: moveKey(reorderable, k, 1) })}
        >
          <Icon name="chevron-down" width={16} height={16} />
        </Button>
        <Toggle
          size="sm"
          icon={<Icon name="star" width={16} height={16} />}
          aria-label={`Pin ${t} to the top`}
          pressed={lw.pinned}
          onPressedChange={(on) => commit({ ...current, pinned: on ? [...current.pinned.filter((x) => x !== k), k] : current.pinned.filter((x) => x !== k) })}
        />
        {!workspace ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={lw.widget.span === "full" ? `Make ${t} half width` : `Make ${t} full width`}
          onClick={() => commit({ ...current, size: { ...current.size, [k]: lw.widget.span === "full" ? "half" : "full" } })}
        >
          <Icon name="expand" width={16} height={16} />
        </Button>
        ) : null}
        </> : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Hide ${t}`}
          onClick={() =>
            commit(
              lw.extra
                ? { ...current, extras: current.extras.filter((e) => e.key !== k) }
                : { ...current, hidden: [...current.hidden, k], pinned: current.pinned.filter((x) => x !== k) },
            )
          }
        >
          <Icon name="eye-off" width={16} height={16} />
        </Button>
      </>
    );
  };

  const actions = (
    <>
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger render={<BoardHeaderButton icon="settings" aria-label="Board settings" title="Board settings" />} />
        <PopoverContent align="end" className="fd-board-settings">
          <div className="grid min-w-0 gap-3">
            <PopoverTitle>Board settings</PopoverTitle>
            {(hasMap || finance) && (
              <Select
                aria-label="Dashboard preset"
                size="sm"
                value={mapDesign && hasMap ? "map-overlay" : "standard"}
                onValueChange={(value) => {
                  if (value !== "standard" && value !== "map-overlay") return;
                  commit({
                    ...current,
                    design: value,
                    hidden: value === "map-overlay"
                      ? current.hidden.filter((key) => !available.some((widget) => widget.type === "map" && widgetKeyOf(widget) === key))
                      : current.hidden,
                  });
                  setSettingsOpen(false);
                }}
              >
                <SelectTrigger className="w-full min-w-0" onKeyDownCapture={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return;
                  const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
                  // Enter commits the preset. Typing into a closed selector must not change it.
                  if ((expanded && event.key === " ") || (!expanded && event.key !== " " && event.key.length === 1)) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }} />
                <SelectContent>
                  <SelectItem value="standard" label={standardLabel}>
                    {standardLabel}
                    {!recommendMonitor && <span className="ml-2 text-xs text-muted-foreground">Recommended</span>}
                  </SelectItem>
                  {hasMap && !finance && (
                    <SelectItem value="map-overlay" label="Natural disaster monitor">
                      Natural disaster monitor
                      {recommendMonitor && <span className="ml-2 text-xs text-muted-foreground">Recommended</span>}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            {workspace && chartTables.length > 0 && (
              <fieldset className="min-w-0 border-t border-hairline pt-2">
                <legend className="px-1 text-sm">Overview chart</legend>
                <Select aria-label="Overview chart" size="sm" value={chartWidget ? widgetKeyOf(chartWidget) : "none"}
                  onValueChange={(value) => {
                    const widget = chartTables.find((item) => widgetKeyOf(item) === value);
                    commit({ ...current, overviewChart: widget ? { type: "donut", widget: widgetKeyOf(widget) } : undefined });
                  }}>
                  <SelectTrigger className="w-full min-w-0" />
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {chartTables.map((widget) => (
                      <SelectItem key={widgetKeyOf(widget)} value={widgetKeyOf(widget)}>{widget.title} by status (donut)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </fieldset>
            )}
            {available.length > 0 && (
              <fieldset className="grid min-w-0 gap-2 border-t border-hairline pt-2">
                <legend className="px-1 text-sm">Visible sections</legend>
                <div className="grid max-h-56 min-w-0 gap-2 overflow-x-hidden overflow-y-auto pe-1">
                  {available.filter((widget) => !workspace || widget.type !== "map").map((widget) => {
                    const key = widgetKeyOf(widget);
                    return (
                      <Switch key={key} size="sm" label={widget.title}
                        checked={!current.hidden.includes(key)}
                        onCheckedChange={(shown) => commit({
                          ...current,
                          hidden: shown ? current.hidden.filter((x) => x !== key) : [...current.hidden, key],
                          pinned: shown ? current.pinned : current.pinned.filter((x) => x !== key),
                        })} />
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {!workspace && editAction}
      <Menu>
        <MenuTrigger asChild>
          <BoardHeaderButton icon="more" aria-label="Board actions" />
        </MenuTrigger>
        <MenuContent placement="bottom-end" aria-label="Board actions">
          {!localPreview && <MenuItem disabled={!!busy} onSelect={() => void undo()}>Undo</MenuItem>}
          <MenuItem onSelect={() => router.push(boardUrl(board.slug))}>Open shared board</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => setResetOpen(true)} data-sw-confirm="">Reset layout</MenuItem>
        </MenuContent>
      </Menu>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset your layout?</AlertDialogTitle>
            <AlertDialogDescription>Restore the default layout, widget visibility, pins and filters for this board.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" data-sw-confirm="" onClick={() => commit(emptyLayout(board.version))}>
              Reset layout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {saving && <Text as="span" role="status" className="sr-only">Saving dashboard settings…</Text>}
    </>
  );

  const hiddenSections = (
    <Card padding="md" className="gap-3">
          <Heading as="h2" size="sm">
            Hidden sections
          </Heading>
          {hiddenWidgets.length ? (
            <ul className="flex flex-wrap gap-2">
              {hiddenWidgets.map((w) => {
                const k = widgetKeyOf(w);
                return (
                  <li key={k}>
                    <Button variant="outline" size="sm" onClick={() => commit({ ...current, hidden: current.hidden.filter((x) => x !== k) })}>
                      Show {w.title}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState headingLevel={3} title="Nothing is hidden" description="Hide a section with its eye button while you edit." />
          )}
          {!localPreview && <div>
            <AlertDialog>
              <AlertDialogTrigger variant="danger" size="sm" loading={busy === "remove"} data-sw-confirm="">
                Remove from my dashboards
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this dashboard?</AlertDialogTitle>
                  <AlertDialogDescription>Your layout, filters and pins for this topic are deleted. The shared board stays.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction variant="danger" data-sw-confirm="" onClick={() => remove()}>
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>}
        </Card>
  );
  const editForm = (
    <form
        aria-label="Change your dashboard"
        className={workspace ? "flex flex-col gap-2" : "fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-canvas/90 backdrop-blur-md"}
        onSubmit={(e) => {
          e.preventDefault();
          void sendEdit();
        }}
      >
        <div className={workspace ? "flex min-w-0 flex-col gap-2" : "mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3"}>
          {reply ? (
            <Text size="sm" tone="subtle" role="status">
              {reply.text}
              {reply.unsupported.length ? ` Not tracked yet, request noted: ${reply.unsupported.join("; ")}.` : ""}
            </Text>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Textarea
                aria-label="Describe how you want your dashboard"
                value={instruction}
                onValueChange={(v) => setInstruction(v.slice(0, MAX_INSTRUCTION))}
                minRows={1}
                maxRows={4}
                placeholder="Make the map bigger and put shelters at the top"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendEdit();
                  }
                }}
              />
            </div>
            <Button type="submit" variant="accent" loading={sending} disabled={instruction.trim().length < MIN_INSTRUCTION}>
              Apply
            </Button>
          </div>
        </div>
      </form>
  );

  return (
    <div className={workspace ? "fd-workspace-shell" : "flex flex-col gap-4 pb-40"}>
      <Board
        spec={spec}
        data={data}
        specVersion={board.specVersion}
        title={board.title}
        prompt={board.prompt}
        sources={board.sources}
        events={board.events}
        status={board.status}
        tier={board.tier}
        stage={partial?.stage}
        connected={connected}
        lastPolledAt={board.lastPolledAt}
        onRefresh={localPreview ? undefined : refresh}
        layout={current}
        version={board.version}
        animate
        updatedAt={updatedAt}
        actions={actions}
        tools={tools}
        workspace={workspace}
        cardsOnMap={workspace}
        workspaceNavigation={workspaceNavigation}
        workspaceKey={`personal:${board.id}`}
        workspaceEditAction={workspace ? editAction : undefined}
        workspaceEditor={workspace && editing ? <>{!localPreview && editForm}{hiddenSections}</> : undefined}
      />

      {!workspace && editing ? hiddenSections : null}
      {!workspace && !localPreview ? editForm : null}
      <BoardToasts />
    </div>
  );
}

/** Display filters for the widget types that have one. */
function FilterControl({ lw, onChange }: { lw: LaidOutWidget; onChange: (f: WidgetFilter | null) => void }) {
  const f = lw.filter;
  const t = lw.widget.title;
  switch (lw.widget.type) {
    case "timeline": {
      const v: Importance = f?.kind === "timeline" ? f.minImportance : "all";
      return (
        <SegmentedControl<Importance>
          aria-label={`Which events ${t} shows`}
          size="sm"
          value={v}
          options={importanceOptions}
          onValueChange={(x) => onChange(x === "all" ? null : { kind: "timeline", minImportance: x })}
        />
      );
    }
    case "map":
      return (
        <SegmentedControl<Places>
          aria-label={`Which places ${t} shows`}
          size="sm"
          value={placesOf(f)}
          options={placeOptions}
          onValueChange={(x) => onChange(x === "all" ? null : { kind: "map", pointKinds: placeKinds[x] })}
        />
      );
    case "feed": {
      const types = f?.kind === "feed" ? f.sourceTypes : [];
      const v: Coverage = types.length === 1 && (types[0] === "official" || types[0] === "news") ? types[0] : "all";
      return (
        <SegmentedControl<Coverage>
          aria-label={`Which coverage ${t} shows`}
          size="sm"
          value={v}
          options={coverageOptions}
          onValueChange={(x) => onChange(x === "all" ? null : { kind: "feed", sourceTypes: [x as SourceType] })}
        />
      );
    }
    case "alert-list":
      return (
        <Switch
          size="sm"
          label="In force only"
          checked={f?.kind === "alert-list" && f.activeOnly}
          onCheckedChange={(on) => onChange(on ? { kind: "alert-list", activeOnly: true } : null)}
        />
      );
    case "table":
      return <TableFilter title={t} query={f?.kind === "table" ? f.query : null} onChange={onChange} />;
    default:
      return null;
  }
}

function TableFilter({ title, query, onChange }: { title: string; query: string | null; onChange: (f: WidgetFilter | null) => void }) {
  const [text, setText] = useState(query ?? "");
  return (
    <Popover>
      <PopoverTrigger variant={query ? "secondary" : "ghost"} size="sm" aria-label={`Filter ${title}`}>
        <Icon name="search" width={16} height={16} />
      </PopoverTrigger>
      <PopoverContent align="end">
        <form
          className="flex w-64 max-w-full flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = text.trim().slice(0, 120);
            onChange(q ? { kind: "table", query: q } : null);
          }}
        >
          <PopoverTitle>Show rows that mention</PopoverTitle>
          <Input aria-label={`Text to find in ${title}`} size="sm" value={text} onValueChange={setText} clearable placeholder="For example: north" />
          <Button type="submit" size="sm" variant="outline">
            Apply filter
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
