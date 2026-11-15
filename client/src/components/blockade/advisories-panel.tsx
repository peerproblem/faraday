"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BarList } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import type { AlertListData, Widget } from "@/lib/spec";
import { advisorySides, issuerSide, sideColor } from "./blockade-data";
import { BoardWidget, Dot, PanelSection, type BlockadeContext } from "./widget";

export function AdvisoriesPanel({ context, widget, items, links }: {
  context: BlockadeContext;
  widget: Widget | undefined;
  items: AlertListData["items"];
  links: Widget | undefined;
}) {
  const [side, setSide] = useState<string | null>(null);
  if (!widget || !items.length) {
    return <EmptyState title="No official advisories" description="The sources have no official advisories for this topic." />;
  }
  const sides = advisorySides(items);
  const active = items.filter((item) => item.active).length;
  const shown = side ? items.filter((item) => issuerSide(item.issuer) === side) : items;
  return (
    <>
      {sides.length > 1 && (
        <PanelSection title="Who is warning mariners" aside={side ? (
          <Button size="sm" variant="ghost" onClick={() => setSide(null)}>Show all</Button>
        ) : `${active} active`}>
          <BarList aria-label="Active advisories by issuing side"
            items={sides.map((item) => ({ ...item, icon: <Dot color={sideColor(item.id)} /> }))} format={(value) => value.toLocaleString("en-US")}
            onItemAction={(id) => setSide(id === side ? null : id)} />
          <Text size="sm" tone="muted">Select a row to see that side&apos;s advisories.</Text>
        </PanelSection>
      )}

      <PanelSection title={side ? `Advisories from ${side}` : "Advisories"} aside={`${shown.length} listed`}>
        <BoardWidget key={side ?? "all"} widget={widget} context={context} data={{ items: shown }} />
      </PanelSection>

      {links && (
        <PanelSection title="Official portals">
          <BoardWidget widget={links} context={context} />
        </PanelSection>
      )}
    </>
  );
}
