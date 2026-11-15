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
import { clearAdminBoardLayout, getAdminBoardLayout, getLayoutLibrary, saveAdminBoardLayout, saveLayoutTemplate } from "@/lib/client/views-api";
import { boardUrl } from "@/lib/config";
import type { BoardCard, BoardLayout, BoardLayoutAssignment, BoardLayoutTemplate } from "@/lib/spec";

const defaults = (layout: BoardLayout["layout"]): BoardLayout => ({ layout, timelineOpen: true, evidenceOpen: false });
type BoardChoice = Pick<BoardCard, "id" | "title" | "slug">;

function LayoutFields({ settings, onChange, canUseMap = true }: {
  settings: BoardLayout;
  onChange: (settings: BoardLayout) => void;
  canUseMap?: boolean;
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
      {settings.layout === "map" && <>
        <Switch size="sm" label="Open timeline by default" checked={settings.timelineOpen}
          onCheckedChange={(timelineOpen) => onChange({ ...settings, timelineOpen })} />
        <Switch size="sm" label="Open Evidence by default" checked={settings.evidenceOpen}
          onCheckedChange={(evidenceOpen) => onChange({ ...settings, evidenceOpen })} />
      </>}
    </>
  );
}

function TemplateEditor({ templates, onSaved }: { templates: BoardLayoutTemplate[]; onSaved: (template: BoardLayoutTemplate) => void }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [settings, setSettings] = useState(() => defaults("map"));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const template = await saveLayoutTemplate(templateId, name.trim(), settings);
      onSaved(template);
      setTemplateId(template.id);
      toast.success("Template saved");
    } catch (error) {
      toast.danger("Could not save template", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Template library" headingLevel={3}>
      <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Text size="sm" tone="muted">Template edits apply the next time a template is used. Each board keeps its saved layout.</Text>
        <Select aria-label="Template to edit" size="sm" value={templateId ?? "new"} disabled={saving}
          onValueChange={(id) => {
            const template = templates.find((entry) => entry.id === id);
            setTemplateId(template?.id ?? null);
            setName(template?.name ?? "");
            setSettings(template?.settings ?? defaults("map"));
          }}>
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
        <Button type="submit" variant="primary" size="sm" className="self-start" loading={saving} disabled={!name.trim()}>
          Save template
        </Button>
      </form>
    </Card>
  );
}

function BoardLayoutEditor({ board, templates }: { board: BoardChoice; templates: BoardLayoutTemplate[] }) {
  const [loaded, setLoaded] = useState<{ canUseMap: boolean; assignment: BoardLayoutAssignment | null } | null>(null);
  const [settings, setSettings] = useState(() => defaults("grid"));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void getAdminBoardLayout(board.id).then((result) => {
      if (!active) return;
      setLoaded(result);
      setSettings(result.assignment?.settings ?? defaults(result.canUseMap ? "map" : "grid"));
      setTemplateId(result.assignment?.templateId ?? null);
    }, (reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [board.id]);

  async function save(reset = false) {
    setBusy(true);
    setError(undefined);
    try {
      const { assignment } = reset
        ? await clearAdminBoardLayout(board.id)
        : await saveAdminBoardLayout(board.id, { templateId, settings });
      if (loaded) {
        setLoaded({ ...loaded, assignment });
        setTemplateId(assignment?.templateId ?? null);
        setSettings(assignment?.settings ?? defaults(loaded.canUseMap ? "map" : "grid"));
      }
      toast.success(reset ? "Default layout restored" : "Board layout saved");
    } catch (reason) {
      setError((reason as Error).message);
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
      <LayoutFields settings={settings} onChange={setSettings} canUseMap={loaded.canUseMap} />
      {error && <Text role="alert" size="sm">{error}</Text>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!loaded.canUseMap && settings.layout === "map"}>
          Save for this board
        </Button>
        {loaded.assignment && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(true)}>
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
