"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { useReorder } from "@/components/ui/reorder";
import { cardBounds, WorkspaceResizeHandle, type CornerWidth, type useWorkspaceSizes } from "./workspace-resize";

export type WorkspaceCard = { id: `card:${string}`; label: string; content: ReactNode; open: boolean };
type StackCard = Omit<WorkspaceCard, "id"> & { id: WorkspaceCard["id"] | "situation" | "evidence" };

type BoardCardStackProps = {
  id: string;
  cards: StackCard[];
  onOpenChange: (name: StackCard["id"], open: boolean) => void;
  resize: ReturnType<typeof useWorkspaceSizes>;
  detailsWidth?: CornerWidth;
  flowing?: boolean;
  contentSized?: boolean;
  fadeScrollEdges?: boolean;
};

export function BoardCardStack({ id, cards, onOpenChange, resize, detailsWidth, flowing, fadeScrollEdges, contentSized }: BoardCardStackProps) {
  const [order, setOrder] = useState<string[]>([]);
  const byId = new Map<string, StackCard>(cards.map((card) => [card.id, card]));
  const ids = [...order.filter((key) => byId.has(key)), ...cards.map((card) => card.id).filter((key) => !order.includes(key))];
  const reorder = useReorder({
    ids,
    onReorder: setOrder,
    disabled: cards.length < 2,
    getLabel: (name) => byId.get(name)?.label ?? name,
  });

  return (
    <div {...reorder.getContainerProps()} id={id} className="fd-workspace-card-stack"
      data-content-sized={contentSized ? "" : undefined}
      style={flowing ? {
        overflow: "hidden auto", overscrollBehavior: "contain", pointerEvents: "auto",
        ...(fadeScrollEdges && {
          paddingBlock: "var(--sw-space-3)",
          scrollPaddingBlock: "var(--sw-space-3)",
          maskImage: "linear-gradient(to bottom, transparent, black var(--sw-space-3), black calc(100% - var(--sw-space-3)), transparent)",
        }),
      } : undefined}>
      {ids.map((key) => {
        const { id: name, label, content, open } = byId.get(key)!;
        const cardId = `${id}-${name}`;
        const cardSize = resize(name);
        const height = !flowing && open ? cardSize.value : undefined;
        return (
          <Card key={name} {...reorder.getItemProps(name)} id={cardId} role="region" aria-label={label}
            radius="lg" padding="none" bordered className="fd-workspace-detail-card" data-open={open ? "" : undefined}
            data-fixed-height={height ? "" : undefined}
            style={flowing ? { flex: "0 0 auto", minHeight: 0 }
              : height ? { "--fd-workspace-card-height": `${height}px` } as CSSProperties : undefined}>
            <Collapsible open={open} onOpenChange={(value) => onOpenChange(name, value)}
              keepMounted={name === "situation"} className="fd-workspace-card-fold">
              <div className="fd-workspace-card-header">
                {/* The 24px grip sits 8px inside the card's 20px corners. */}
                {cards.length > 1 && <Button {...reorder.getHandleProps(name)} variant="ghost" size="sm" radius={12}
                  className="size-[var(--sw-space-6)] shrink-0 cursor-grab touch-none" iconOnly title={`Reorder ${label}`}
                  leading={<Icon name="grip" width={16} height={16} />} />}
                <h3 className="min-w-0 flex-1 text-sm font-semibold">
                  <CollapsibleTrigger className="fd-workspace-card-trigger mx-0 w-full justify-between px-1">
                    <span className="fd-workspace-card-label">{label}</span>
                  </CollapsibleTrigger>
                </h3>
              </div>
              <CollapsiblePanel className="fd-workspace-card-body">
                {content}
              </CollapsiblePanel>
            </Collapsible>
            {!flowing && open && <WorkspaceResizeHandle {...cardSize} target={cardId} label={`Resize ${label} card`}
              axis="height" getBounds={cardBounds} cornerWidth={detailsWidth} />}
          </Card>
        );
      })}
      {reorder.dropIndicator}
      {reorder.overlay}
    </div>
  );
}
