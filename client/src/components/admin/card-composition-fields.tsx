"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { widgetTypes, type BoardCardContent, type BoardLayout, type BoardLayoutCard, type Widget } from "@/lib/spec";

type WidgetChoice = Pick<Widget, "type" | "title"> & { key?: string; hasStatus?: boolean };

const widgetTitles: Record<Widget["type"], string> = {
  narrative: "Narrative", "stat-grid": "Key figures", trend: "Trend", timeline: "Timeline", map: "Map",
  table: "Table", "status-grid": "Service status", "alert-list": "Alerts", "link-list": "Links",
  "on-the-ground": "On the ground", feed: "Feed", changelog: "Changes", sources: "Sources",
};

function contentValue(content: BoardCardContent) {
  if (content.kind === "summary") return "summary";
  if (content.kind === "status-chart") return `${content.chart}:${content.key ?? ""}`;
  return `widget:${content.type}:${content.key ?? ""}`;
}

function move<T>(entries: T[], from: number, to: number) {
  const ordered = [...entries];
  ordered.splice(to, 0, ...ordered.splice(from, 1));
  return ordered;
}

export function CardCompositionFields({ settings, onChange, widgets }: {
  settings: BoardLayout;
  onChange: (settings: BoardLayout) => void;
  widgets?: WidgetChoice[];
}) {
  const cards = settings.cards;
  const map = settings.layout === "map";
  const available = (widgets ?? widgetTypes.map((type) => ({ type, title: widgetTitles[type] } as WidgetChoice)))
    .filter(({ type }) => !map || type !== "map");
  const options: { label: string; content: BoardCardContent }[] = [{ label: "Board summary", content: { kind: "summary" } }];
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
  function update(id: string, change: Partial<BoardLayoutCard>) {
    setCards(cards?.map((card) => card.id === id ? { ...card, ...change } : card));
  }
  function newCard(): BoardLayoutCard {
    return { id: crypto.randomUUID(), title: "Details", placement: map ? "right" : "half", open: true, contents: [{ kind: "summary" }] };
  }

  return (
    <fieldset className="grid min-w-0 gap-3 border-t border-hairline pt-2">
      <legend className="pr-2 text-sm font-medium">Cards</legend>
      {cards === undefined ? (
        <Button type="button" size="sm" variant="outline" className="justify-self-start"
          onClick={() => setCards([newCard()])}>Compose cards</Button>
      ) : (
        <>
          <Text size="sm" tone="muted">{map ? "Cards appear on the right of the map in the order below." : "Cards fill the grid in the order below."}</Text>
          {cards.map((card, index) => (
            <fieldset key={card.id} className="grid min-w-0 gap-2 rounded-lg border border-hairline p-3">
              <Field label="Card title"><Input required value={card.title} maxLength={100}
                onValueChange={(title) => update(card.id, { title })} /></Field>
              {map ? (
                <Switch size="sm" label="Open by default" checked={card.open} onCheckedChange={(open) => update(card.id, { open })} />
              ) : (
                <Field label="Width">
                  <Select size="sm" value={card.placement === "full" ? "full" : "half"} onValueChange={(placement) => {
                    if (placement === "full" || placement === "half") update(card.id, { placement });
                  }}>
                    <SelectTrigger className="w-full" />
                    <SelectContent><SelectItem value="half">One column</SelectItem><SelectItem value="full">Full width</SelectItem></SelectContent>
                  </Select>
                </Field>
              )}
              {card.contents.map((content, position) => {
                const value = contentValue(content);
                const missing = !options.some((entry) => contentValue(entry.content) === value);
                return (
                  <div key={position} className="grid min-w-0 gap-1">
                    <Field label={`Content ${position + 1}`}>
                      <Select size="sm" value={value} onValueChange={(value) => {
                        const next = options.find((entry) => contentValue(entry.content) === value);
                        if (next) update(card.id, { contents: card.contents.map((entry, i) => i === position ? next.content : entry) });
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
                        onClick={() => update(card.id, { contents: move(card.contents, position, position - 1) })}>Move content up</Button>
                      <Button type="button" size="xs" variant="ghost" disabled={position === card.contents.length - 1}
                        onClick={() => update(card.id, { contents: move(card.contents, position, position + 1) })}>Move content down</Button>
                      <Button type="button" size="xs" variant="ghost"
                        onClick={() => update(card.id, { contents: card.contents.filter((_, i) => i !== position) })}>Remove content</Button>
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="xs" variant="outline" disabled={card.contents.length >= 12}
                  onClick={() => update(card.id, { contents: [...card.contents, { kind: "summary" }] })}>Add content</Button>
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
            <Button type="button" size="sm" variant="ghost" onClick={() => setCards()}>Use default cards</Button>
          </div>
        </>
      )}
    </fieldset>
  );
}
