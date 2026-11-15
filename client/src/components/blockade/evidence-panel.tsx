"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import type { Widget } from "@/lib/spec";
import { BoardWidget, type BlockadeContext } from "./widget";

/** Where the board's facts come from: the sources it read, what changed between checks, and the raw Context.dev results. */
export function EvidencePanel({ context, sources, changelog, contextEvidence }: {
  context: BlockadeContext;
  sources: Widget | undefined;
  changelog: Widget | undefined;
  contextEvidence: ReactNode;
}) {
  return (
    <Accordion aria-label="Evidence" variant="plain" size="sm" headingLevel={3} multiple defaultValue={["sources"]}>
      {sources && (
        <AccordionItem value="sources">
          <AccordionTrigger meta={<Badge variant="neutral">{context.allSources.length}</Badge>}>Sources read</AccordionTrigger>
          <AccordionPanel>
            <BoardWidget widget={sources} context={context} extra={{ collapseSourceGroups: true, wrapSourceTitles: true }} />
          </AccordionPanel>
        </AccordionItem>
      )}
      {changelog && (
        <AccordionItem value="changes">
          <AccordionTrigger>Changes between checks</AccordionTrigger>
          <AccordionPanel><BoardWidget widget={changelog} context={context} /></AccordionPanel>
        </AccordionItem>
      )}
      <AccordionItem value="context">
        <AccordionTrigger>Context.dev results</AccordionTrigger>
        <AccordionPanel>{contextEvidence}</AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
