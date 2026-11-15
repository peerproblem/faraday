"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SourceMark } from "@/components/sources/source-mark";
import { AvatarGroup } from "@/components/ui/avatar";
import { Caption, Text } from "@/components/ui/typography";
import type { Source, TimelineData } from "@/lib/spec";
import { sourceLabel } from "@/lib/source-brand";
import { toMs, when } from "@/lib/time";
import { SourceChips } from "./source-chips";

type Item = TimelineData["items"][number];

/** Where the active step is picked: this far down the part of the panel the steps scroll through. */
const READING_LINE = 0.35;

/** Oldest first, so the story reads in the order it happened. Events without a time go last, as listed. */
export function storyOrder(items: Item[]): Item[] {
  const dated = items.filter((t) => toMs(t.at) !== null).sort((a, b) => toMs(a.at)! - toMs(b.at)!);
  return [...dated, ...items.filter((t) => toMs(t.at) === null)];
}

/** Each event's place on the period's date axis, as a percentage of its width. Undated events sit at the end. */
function axisOf(steps: Item[]): number[] {
  const times = steps.map((t) => toMs(t.at)).filter((ms): ms is number => ms !== null);
  const lo = Math.min(...times);
  const span = Math.max(...times) - lo;
  return steps.map((t) => {
    const ms = toMs(t.at);
    if (ms === null) return 98;
    return span > 0 ? 4 + ((ms - lo) / span) * 90 : 50;
  });
}

const dayOf = (t: string | null) => {
  const ms = toMs(t);
  return ms === null ? "Date unknown" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * The timeline told as a story (widget display "story"): one step per event in a scrolling panel inside the card.
 * A sticky stage shows where the active event sits on the date axis and the outlets behind it, the first one large;
 * the step at the reading line is the active one. The stage repeats what the steps say, so it is hidden from
 * assistive technology; the panel itself is a focusable region that scrolls with the keyboard.
 */
export function TimelineStory({ items, sources, label }: { items: Item[]; sources: Map<string, Source>; label: string }) {
  const steps = useMemo(() => storyOrder(items), [items]);
  const xs = useMemo(() => axisOf(steps), [steps]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);

  const index = Math.max(0, steps.findIndex((t) => t.id === activeId));
  const active = steps[index];
  const cited = (active?.sources ?? []).map((id) => sources.get(id)).filter((s): s is Source => !!s);
  const [lead, ...rest] = cited;

  /** Top of the area the steps scroll through: below the stage when it sits above them (a narrow card). */
  const stepsTop = () => {
    const st = stage.current?.getBoundingClientRect();
    const ls = list.current?.getBoundingClientRect();
    return st && ls && st.left < ls.right && st.right > ls.left ? st.height : 0;
  };

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let frame = 0;
    const pick = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const rows = Array.from(list.current?.children ?? []) as HTMLElement[];
      if (!box.height || !rows.length) return;
      const top = box.top + stepsTop();
      const line = top + (box.bottom - top) * READING_LINE;
      let i = 0;
      rows.forEach((row, k) => {
        if (row.getBoundingClientRect().top <= line) i = k;
      });
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) i = rows.length - 1;
      setActiveId(rows[i]?.dataset.step ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    pick();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [steps]);

  /** Brings a step to the reading line, from a dot on the axis. */
  const jump = (id: string) => {
    const el = panel.current;
    const row = (Array.from(list.current?.children ?? []) as HTMLElement[]).find((r) => r.dataset.step === id);
    if (!el || !row) return;
    const top = stepsTop();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: row.offsetTop - (top + (el.clientHeight - top) * READING_LINE) + 4, behavior: still ? "auto" : "smooth" });
    setActiveId(id);
  };

  // The active dot is drawn last, on top of any it overlaps.
  const order = steps.map((_, i) => i).sort((a, b) => Number(a === index) - Number(b === index));

  return (
    <div ref={panel} className="fd-story" role="region" aria-label={`${label}, as a story`} tabIndex={0}>
      <div className="fd-story__body">
        <div ref={stage} className="fd-story__stage" aria-hidden="true">
          <div className="flex items-baseline justify-between gap-3">
            <Text size="sm" className="font-medium">
              {dayOf(active?.at ?? null)}
            </Text>
            <Caption>
              {index + 1} of {steps.length}
            </Caption>
          </div>
          <svg className="fd-story__axis" width="100%" height="28" focusable="false">
            <line x1="2%" x2="98%" y1="14" y2="14" />
            {order.map((i) => (
              <circle
                key={steps[i].id}
                cx={`${xs[i]}%`}
                cy="14"
                r={i === index ? 7 : steps[i].importance === "high" ? 4.5 : 3}
                data-active={i === index || undefined}
                data-high={steps[i].importance === "high" || undefined}
                onClick={() => jump(steps[i].id)}
              />
            ))}
          </svg>
          <div key={active?.id} className="fd-story__lead">
            {lead ? (
              <span className="fd-story__portrait">
                <SourceMark source={lead} size={52} />
              </span>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1">
              <Text size="sm" className="truncate font-medium">
                {lead ? sourceLabel(lead) : "Source unknown"}
              </Text>
              {rest.length ? (
                <div className="flex items-center gap-2">
                  <AvatarGroup max={4} size={20} shape="squircle" overlap={0.14}>
                    {rest.map((s) => (
                      <SourceMark key={s.id} source={s} />
                    ))}
                  </AvatarGroup>
                  <Caption>
                    +{rest.length} more {rest.length === 1 ? "outlet" : "outlets"}
                  </Caption>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <ol ref={list} className="fd-story__steps">
          {steps.map((t) => (
            <li key={t.id} data-step={t.id} data-active={t.id === active?.id || undefined} className="fd-story__step">
              {t.importance === "high" ? <Caption className="fd-story__flag">High importance</Caption> : null}
              <Text className="font-medium">{t.title}</Text>
              <Caption>
                <time dateTime={toMs(t.at) !== null ? (t.at ?? undefined) : undefined}>{when(t.at)}</time>
              </Caption>
              <Text size="sm" tone="muted">
                {t.detail ? `${t.detail} ` : null}
                <SourceChips ids={t.sources} sources={sources} evidence={t.evidence} />
              </Text>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
