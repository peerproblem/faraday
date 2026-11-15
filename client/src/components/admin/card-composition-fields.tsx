"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { widgetTypes, type BoardCardContent, type BoardCardSettings, type BoardLayout, type BoardLayoutCard, type Widget } from "@/lib/spec";

type WidgetChoice = Pick<Widget, "type" | "title"> & { key?: string; hasStatus?: boolean };
type ContentOption = { label: string; content: BoardCardContent };

const widgetTitles: Record<Widget["type"], string> = {
  narrative: "Narrative", "stat-grid": "Key figures", trend: "Trend", timeline: "Timeline", map: "Map",
  table: "Table", "status-grid": "Service status", "alert-list": "Alerts", "link-list": "Links",
  "on-the-ground": "On the ground", feed: "Feed", changelog: "Changes", sources: "Sources",
};

function contentValue(content: BoardCardContent) {
  if (content.kind === "summary") return "summary";
  if (content.kind === "incident-status" || content.kind === "automatic-chart") return content.kind;
  if (content.kind === "official-tally") return `official-tally:${content.chart}`;
  if (content.kind === "status-chart") return `${content.chart}:${content.key ?? ""}`;
  return `widget:${content.type}:${content.key ?? ""}`;
}

function move<T>(entries: T[], from: number, to: number) {
  const ordered = [...entries];
  ordered.splice(to, 0, ...ordered.splice(from, 1));
  return ordered;
}

function CardFields({ card, update, options, foldable, titleLabel = "Card title" }: {
  card: BoardCardSettings;
  update: (patch: Partial<BoardCardSettings>) => void;
  options: ContentOption[];
  foldable: boolean;
  titleLabel?: string;
}) {
  return (
    <>
      <Field label={titleLabel}><Input required value={card.title} maxLength={100}
        onValueChange={(title) => update({ title })} /></Field>
      {foldable && <Switch size="sm" label="Open by default" checked={card.open} onCheckedChange={(open) => update({ open })} />}
      {card.contents.map((content, position) => {
        const value = contentValue(content);
        const missing = !options.some((entry) => contentValue(entry.content) === value);
        return (
          <div key={position} className="grid min-w-0 gap-1">
            <Field label={`Content ${position + 1}`}>
              <Select size="sm" value={value} onValueChange={(value) => {
                const next = options.find((entry) => contentValue(entry.content) === value);
                if (next) update({ contents: card.contents.map((entry, i) => i === position ? next.content : entry) });
              }}>
                <SelectTrigger className="w-full" />
                <SelectContent>
                  {missing && <SelectItem value={value}>{content.kind === "widget" && !content.key ? `Any ${widgetTitles[content.type]}`
                    : content.kind === "status-chart" && !content.key ? `Any status table (${content.chart})` : "Unavailable on this board"}</SelectItem>}
                  {options.map((entry) => <SelectItem key={contentValue(entry.content)} value={contentValue(entry.content)}>{entry.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="xs" variant="ghost" disabled={position === 0}
                onClick={() => update({ contents: move(card.contents, position, position - 1) })}>Move content up</Button>
              <Button type="button" size="xs" variant="ghost" disabled={position === card.contents.length - 1}
                onClick={() => update({ contents: move(card.contents, position, position + 1) })}>Move content down</Button>
              <Button type="button" size="xs" variant="ghost"
                onClick={() => update({ contents: card.contents.filter((_, i) => i !== position) })}>Remove content</Button>
            </div>
          </div>
        );
      })}
      <Button type="button" size="xs" variant="outline" className="justify-self-start" disabled={card.contents.length >= 12}
        onClick={() => update({ contents: [...card.contents, { kind: "summary" }] })}>Add content</Button>
    </>
  );
}

export function CardCompositionFields({ settings, onChange, widgets }: {
  settings: BoardLayout;
  onChange: (settings: BoardLayout) => void;
  widgets?: WidgetChoice[];
}) {
  const { cards, sidebar } = settings;
  const map = settings.layout === "map";
  const available = (widgets ?? widgetTypes.map((type): WidgetChoice => ({ type, title: widgetTitles[type] })))
    .filter(({ type }) => !map || type !== "map");
  const options: ContentOption[] = [
    { label: "Board summary", content: { kind: "summary" } },
    { label: "Automatic chart", content: { kind: "automatic-chart" } },
    { label: "Incidents requiring a response", content: { kind: "incident-status" } },
    { label: "Latest official tally", content: { kind: "official-tally", chart: "none" } },
    { label: "Latest official tally with automatic chart", content: { kind: "official-tally", chart: "auto" } },
    { label: "Latest official tally with donut", content: { kind: "official-tally", chart: "donut" } },
    { label: "Latest official tally with bars", content: { kind: "official-tally", chart: "bars" } },
  ];
  for (const { key, title, type, hasStatus } of available) {
    options.push({ label: title, content: { kind: "widget", type, key } });
    if (type === "table" && hasStatus !== false) {
      options.push(
        { label: `${title} by status (donut)`, content: { kind: "status-chart", chart: "donut", key } },
        { label: `${title} by status (bars)`, content: { kind: "status-chart", chart: "bars", key } },
      );
    }
  }

  function setCards(cards?: BoardLayoutCard[]) { onChange({ ...settings, cards }); }
  function updateCard(id: string, change: Partial<BoardLayoutCard>) {
    setCards(cards?.map((card) => card.id === id ? { ...card, ...change } : card));
  }
  function newCard(): BoardLayoutCard {
    return { id: crypto.randomUUID(), title: "Details", placement: map ? "right" : "half", open: true, contents: [{ kind: "summary" }] };
  }

  return (
    <>
      {map && (
        <fieldset className="grid min-w-0 gap-2 border-t border-hairline pt-2">
          <legend className="pr-2 text-sm font-medium">Left sidebar</legend>
          <Select aria-label="Left sidebar" size="sm" value={sidebar === undefined ? "timeline" : sidebar === null ? "hidden" : "custom"}
            onValueChange={(mode) => {
              if (mode === "timeline") onChange({ ...settings, sidebar: undefined });
              if (mode === "hidden") onChange({ ...settings, sidebar: null });
              if (mode === "custom") onChange({ ...settings, sidebar: { title: "Details", open: true, contents: [{ kind: "summary" }] } });
            }}>
            <SelectTrigger className="w-full" />
            <SelectContent>
              <SelectItem value="timeline">Timeline when available</SelectItem>
              <SelectItem value="custom">Custom contents</SelectItem>
              <SelectItem value="hidden">Hidden</SelectItem>
            </SelectContent>
          </Select>
          {sidebar === undefined && <Switch size="sm" label="Open timeline by default" checked={settings.timelineOpen}
            onCheckedChange={(timelineOpen) => onChange({ ...settings, timelineOpen })} />}
          {sidebar && <CardFields card={sidebar} options={options} foldable titleLabel="Sidebar title"
            update={(patch) => onChange({ ...settings, sidebar: { ...sidebar, ...patch } })} />}
        </fieldset>
      )}
      {map && (
        <fieldset className="grid min-w-0 gap-2 border-t border-hairline pt-2">
          <legend className="pr-2 text-sm font-medium">Map overlay card</legend>
          {settings.mapCard ? <>
            <CardFields card={settings.mapCard} options={options} foldable={false}
              update={(patch) => onChange({ ...settings, mapCard: { ...settings.mapCard!, ...patch } })} />
            <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ ...settings, mapCard: undefined })}>Remove map overlay card</Button>
          </> : <Button type="button" size="sm" variant="outline" onClick={() => onChange({
            ...settings, mapCard: { title: "Current warnings", open: true, contents: [{ kind: "widget", type: "alert-list" }] },
          })}>Add map overlay card</Button>}
        </fieldset>
      )}
      <fieldset className="grid min-w-0 gap-3 border-t border-hairline pt-2">
        <legend className="pr-2 text-sm font-medium">{map ? "Right cards" : "Cards"}</legend>
        {cards === undefined ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setCards([newCard()])}>Compose cards</Button>
            {map && <Button type="button" size="sm" variant="ghost" onClick={() => setCards([])}>Hide detail cards</Button>}
          </div>
        ) : (
          <>
            {cards.map((card, index) => (
              <fieldset key={card.id} className="grid min-w-0 gap-2 rounded-lg border border-hairline p-3">
                <CardFields card={card} options={options} foldable={map} update={(patch) => updateCard(card.id, patch)} />
                {!map && (
                  <Field label="Width">
                    <Select size="sm" value={card.placement === "full" ? "full" : "half"} onValueChange={(placement) => {
                      if (placement === "full" || placement === "half") updateCard(card.id, { placement });
                    }}>
                      <SelectTrigger className="w-full" />
                      <SelectContent><SelectItem value="half">One column</SelectItem><SelectItem value="full">Full width</SelectItem></SelectContent>
                    </Select>
                  </Field>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button type="button" size="xs" variant="ghost" disabled={index === 0}
                    onClick={() => setCards(move(cards, index, index - 1))}>Move card up</Button>
                  <Button type="button" size="xs" variant="ghost" disabled={index === cards.length - 1}
                    onClick={() => setCards(move(cards, index, index + 1))}>Move card down</Button>
                  <Button type="button" size="xs" variant="ghost"
                    onClick={() => setCards(cards.filter(({ id }) => id !== card.id))}>Remove card</Button>
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={cards.length >= 20}
                onClick={() => setCards([...cards, newCard()])}>Add card</Button>
              {map && cards.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setCards([])}>Hide detail cards</Button>}
              <Button type="button" size="sm" variant="ghost" onClick={() => setCards()}>Use default cards</Button>
            </div>
          </>
        )}
      </fieldset>
    </>
  );
}
