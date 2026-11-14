"use client";

import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Link } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import { AsOf } from "./as-of";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";
import { Empty } from "./widget-frame";

const levelTone: Record<string, BadgeVariant> = { warning: "danger", watch: "warning", info: "neutral" };
const levelLabel: Record<string, string> = { warning: "Warning", watch: "Watch", info: "Info" };

export function AlertListWidget({ widget, data, sources, tier, building, filter }: WidgetProps<"alert-list">) {
  const all = (data?.items ?? []).filter((a) => a && typeof a.id === "string" && a.title);
  const items = filter?.activeOnly ? all.filter((a) => a.active) : all;
  if (!items.length)
    return (
      <Empty
        building={building}
        title={all.length ? "No advisories in force" : "No official advisories"}
        description={all.length ? "Every advisory in the sources has been lifted." : "The sources have no official advisories for this topic."}
      />
    );
  const sorted = [...items].sort((a, b) => Number(b.active) - Number(a.active));
  const firstActive = sorted.find((a) => a.active)?.id;
  return (
    <Accordion aria-label={widget.title} variant="plain" headingLevel={3} defaultValue={firstActive ? [firstActive] : []}>
      {sorted.map((a) => (
        <AccordionItem key={a.id} value={a.id}>
          <AccordionTrigger
            meta={
              a.active ? (
                <Badge variant={levelTone[a.level] ?? "neutral"}>{levelLabel[a.level] ?? a.level}</Badge>
              ) : (
                <Badge variant="outline">Lifted</Badge>
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
                    <Link href={a.url} target="_blank" rel="noreferrer">
                      Official notice
                    </Link>
                  </Text>
                ) : null}
                <SourceChips ids={a.sources} sources={sources} evidence={a.evidence} />
                <AsOf t={a.asOf} tier={tier} prefix="issued" />
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
