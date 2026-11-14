"use client";

import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { ToneBadge, type Tone } from "@/components/ui/badge";
import { TextLink } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const levelTone: Record<string, Tone> = { warning: "danger", watch: "warning", info: "accent" };
const levelLabel: Record<string, string> = { warning: "Warning", watch: "Watch", info: "Info" };

export function AlertListWidget({ widget, data, sources, tier, building }: WidgetProps<"alert-list">) {
  const items = (data?.items ?? []).filter((a) => a && typeof a.id === "string" && a.title);
  if (!items.length) return <Empty building={building}>No official advisories found in the sources.</Empty>;
  const sorted = [...items].sort((a, b) => Number(b.active) - Number(a.active));
  const firstActive = sorted.find((a) => a.active)?.id;
  return (
    <Accordion aria-label={widget.title} variant="plain" headingLevel={3} defaultValue={firstActive ? [firstActive] : []}>
      {sorted.map((a) => (
        <AccordionItem key={a.id} value={a.id}>
          <AccordionTrigger
            meta={
              a.active ? (
                <ToneBadge tone={levelTone[a.level] ?? "accent"} mono>
                  {levelLabel[a.level] ?? a.level}
                </ToneBadge>
              ) : (
                <ToneBadge tone="neutral" mono>
                  Lifted
                </ToneBadge>
              )
            }
          >
            {a.title}
          </AccordionTrigger>
          <AccordionPanel>
            <div className="flex flex-col gap-2">
              <Text size="sm" tone="muted">
                {a.issuer}
              </Text>
              <Text size="sm" tone="subtle">
                {a.text}
              </Text>
              <div className="flex flex-wrap items-center gap-2">
                {a.url ? (
                  <Text as="span" size="sm">
                    <TextLink href={a.url} external>
                      Official notice
                    </TextLink>
                  </Text>
                ) : null}
                <SourceChips ids={a.sources} sources={sources} />
                <AsOf t={a.asOf} tier={tier} prefix="issued" />
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
