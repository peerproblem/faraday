"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { toast } from "@/components/ui/toast";
import { ApiError, clearAdminBoardLayout, getAdminBoardLayout, getLayoutLibrary, saveAdminBoardLayout, saveLayoutTemplate } from "@/lib/client/views-api";
import { boardUrl } from "@/lib/config";
import type { BoardCard, BoardLayout, BoardLayoutAssignment, BoardLayoutTemplate } from "@/lib/spec";
import { CardCompositionFields } from "./card-composition-fields";

const defaults = (layout: BoardLayout["layout"]): BoardLayout => ({ layout, timelineOpen: true, evidenceOpen: false });
type BoardChoice = Pick<BoardCard, "id" | "title" | "slug">;

function LayoutFields({ settings, onChange, canUseMap = true, widgets }: {
  settings: BoardLayout;
  onChange: (settings: BoardLayout) => void;
  canUseMap?: boolean;
  widgets?: Awaited<ReturnType<typeof getAdminBoardLayout>>["widgets"];
}) {
  return (
    <>
      <Field label="Layout">
        <Select size="sm" value={settings.layout} onValueChange={(layout) => {
          if (layout === "map" || layout === "grid") onChange({ ...settings, layout });
        }}>
          <SelectTrigger className="w-full" />
          <SelectContent>
            <SelectItem value="map" disabled={!canUseMap}>Map with floating cards</SelectItem>
            <SelectItem value="grid">Widget grid</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {settings.layout === "map" && settings.cards === undefined && <Switch size="sm" label="Open Evidence by default" checked={settings.evidenceOpen}
        onCheckedChange={(evidenceOpen) => onChange({ ...settings, evidenceOpen })} />}
      <CardCompositionFields settings={settings} onChange={onChange} widgets={widgets} />
    </>
  );
}

function TemplateEditor({ templates, onSaved }: { templates: BoardLayoutTemplate[]; onSaved: (template: BoardLayoutTemplate) => void }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [settings, setSettings] = useState(() => defaults("map"));
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0);
  const [conflict, setConflict] = useState<BoardLayoutTemplate>();

  function load(template?: BoardLayoutTemplate) {
    setTemplateId(template?.id ?? null);
    setName(template?.name ?? "");
    setSettings(template?.settings ?? defaults("map"));
    setRev(template?.rev ?? 0);
    setConflict(undefined);
  }

  async function save() {
    if (saving || conflict) return;
    setSaving(true);
    try {
      const template = await saveLayoutTemplate(templateId, name.trim(), settings, rev);
      onSaved(template);
      load(template);
      toast.success("Template saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(error.body.current as BoardLayoutTemplate);
      else toast.danger("Could not save template", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Template library" headingLevel={3}>
      <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Text size="sm" tone="muted">Template edits apply the next time a template is used. Each board keeps its saved layout.</Text>
        <Select aria-label="Template to edit" size="sm" value={templateId ?? "new"} disabled={saving}
          onValueChange={(id) => load(templates.find((entry) => entry.id === id))}>
          <SelectTrigger className="w-full" />
          <SelectContent>
            <SelectItem value="new">Create a template</SelectItem>
            {templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Field label="Template name">
          <Input value={name} onValueChange={setName} maxLength={100} required />
        </Field>
        <LayoutFields settings={settings} onChange={setSettings} />
        {conflict && <div className="grid gap-2">
          <Text role="alert" size="sm">Another admin saved this template. Your draft is still here.</Text>
          <Button type="button" size="sm" variant="outline" className="justify-self-start"
            onClick={() => { onSaved(conflict); load(conflict); }}>Replace draft with saved template</Button>
        </div>}
        <Button type="submit" variant="primary" size="sm" className="self-start" loading={saving} disabled={!name.trim() || !!conflict}>
          Save template
        </Button>
      </form>
    </Card>
  );
}

function BoardLayoutEditor({ board, templates }: { board: BoardChoice; templates: BoardLayoutTemplate[] }) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof getAdminBoardLayout>> | null>(null);
  const [settings, setSettings] = useState(() => defaults("grid"));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<{ rev: number; assignment: BoardLayoutAssignment | null }>();

  function load(result: NonNullable<typeof loaded>) {
    setLoaded(result);
    setSettings(result.assignment?.settings ?? defaults(result.canUseMap ? "map" : "grid"));
    setTemplateId(result.assignment?.templateId ?? null);
    setConflict(undefined);
  }

  useEffect(() => {
    let active = true;
    void getAdminBoardLayout(board.id).then((result) => {
      if (!active) return;
      load(result);
    }, (reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [board.id]);

  async function save(reset = false) {
    if (!loaded || busy || conflict) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = reset
        ? await clearAdminBoardLayout(board.id, loaded.rev)
        : await saveAdminBoardLayout(board.id, { templateId, settings, rev: loaded.rev });
      load({ ...loaded, ...result });
      toast.success(reset ? "Default layout restored" : "Board layout saved");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setConflict(reason.body.current as typeof conflict);
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return error ? <Text role="alert" size="sm">{error}</Text> : <Skeleton className="h-12 w-full" />;
  return (
    <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Field label="Start from a template">
        <Select size="sm" disabled={busy} value={templateId ?? "custom"} onValueChange={(id) => {
          const template = templates.find((entry) => entry.id === id);
          setTemplateId(template?.id ?? null);
          if (template) setSettings({ ...template.settings });
        }}>
          <SelectTrigger className="w-full" />
          <SelectContent>
            <SelectItem value="custom">Custom layout</SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id} disabled={!loaded.canUseMap && template.settings.layout === "map"}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <LayoutFields settings={settings} onChange={setSettings} canUseMap={loaded.canUseMap} widgets={loaded.widgets} />
      {error && <Text role="alert" size="sm">{error}</Text>}
      {conflict && <div className="grid gap-2">
        <Text role="alert" size="sm">Another admin saved this board layout. Your draft is still here.</Text>
        <Button type="button" size="sm" variant="outline" className="justify-self-start"
          onClick={() => load({ ...loaded, ...conflict })}>Replace draft with saved layout</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!!conflict || (!loaded.canUseMap && settings.layout === "map")}>
          Save for this board
        </Button>
        {loaded.assignment && <Button type="button" size="sm" variant="ghost" disabled={busy || !!conflict} onClick={() => void save(true)}>
          Restore default
        </Button>}
        <Button href={boardUrl(board.slug)} size="sm" variant="ghost">Open board</Button>
      </div>
    </form>
  );
}

export function AdminLayouts() {
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof getLayoutLibrary>> | null>(null);
  const [error, setError] = useState<string>();
  const [boardId, setBoardId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getLayoutLibrary().then((result) => {
      if (active) setLibrary(result);
    }, (reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  if (!library) return error ? <Text role="alert" size="sm">{error}</Text> : <Skeleton className="h-20 w-full" />;
  const board = library.boards.find((entry) => entry.id === boardId);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <TemplateEditor templates={library.templates} onSaved={(template) => setLibrary({
        ...library,
        templates: [...library.templates.filter((entry) => entry.id !== template.id), template].sort((a, b) => a.name.localeCompare(b.name)),
      })} />
      <Card title="Board layout" headingLevel={3}>
        <div className="grid min-w-0 gap-3">
          <Text size="sm" tone="muted">Choose a board, then save its own copy of a template or a custom layout.</Text>
          <Select aria-label="Board to edit" placeholder="Select a board" searchable size="sm" value={boardId} onValueChange={setBoardId}>
            <SelectTrigger className="w-full" />
            <SelectContent>
              {library.boards.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.title ?? entry.slug}</SelectItem>)}
            </SelectContent>
          </Select>
          {board && <BoardLayoutEditor key={board.id} board={board} templates={library.templates} />}
        </div>
      </Card>
    </div>
  );
}
