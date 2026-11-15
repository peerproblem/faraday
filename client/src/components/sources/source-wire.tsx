"use client";

import type { CSSProperties } from "react";
import { Ago } from "@/components/ago";
import { Badge } from "@/components/ui/badge";
import { sourceLabel, type WireItem } from "@/lib/source-brand";
import { SourceMark } from "./source-mark";

function Items({ items, hidden = false }: { items: WireItem[]; hidden?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden ? "true" : undefined}>
      {items.map((s) => (
        <li key={`${s.topic ?? ""}:${s.id}`} className="flex shrink-0 items-center pr-8">
          <a href={s.url} target="_blank" rel="noopener noreferrer" tabIndex={hidden ? -1 : undefined} className="flex items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-foreground">
            <SourceMark source={s} size="xs" />
            <span className="font-medium text-foreground">{sourceLabel(s)}</span>
            <span className="max-w-[44ch] truncate">{s.title}</span>
            {s.topic ? <span className="max-w-[24ch] truncate font-mono text-xs uppercase">{s.topic}</span> : null}
            {s.publishedAt ? (
              <span className="text-xs">
                <Ago t={s.publishedAt} />
              </span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The newest headlines the board has read, each with its publisher's logo, as a slow moving line. Every item
 * links to the original. People who ask for less motion get a still row they can scroll.
 */
export function SourceWire({ items, label }: { items: WireItem[]; label?: string }) {
  if (items.length < 3) return null;
  // About six seconds of reading per headline, whatever the length of the list.
  const style = { "--fd-wire-duration": `${Math.max(30, items.length * 6)}s` } as CSSProperties;
  return (
    <section aria-label={label ?? "Recent source headlines"} className="flex min-w-0 items-center gap-3">
      {label && (
        <Badge variant="outline" mono pulse className="shrink-0">
          {label}
        </Badge>
      )}
      <div className="fd-wire min-w-0 flex-1">
        <div className="fd-wire__track" style={style}>
          <Items items={items} />
          <Items items={items} hidden />
        </div>
      </div>
    </section>
  );
}
