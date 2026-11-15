"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { useReorder } from "@/components/ui/reorder";
import { cardBounds, WorkspaceResizeHandle, type CornerWidth, type useWorkspaceSizes } from "./workspace-resize";

const cardLabels = { situation: "Situation", evidence: "Evidence" };
type BoardCardName = keyof typeof cardLabels;

type BoardCardStackProps = {
  id: string;
  situation: ReactNode;
  evidence?: ReactNode;
  open: Record<BoardCardName, boolean>;
  onOpenChange: (name: BoardCardName, open: boolean) => void;
  resize: ReturnType<typeof useWorkspaceSizes>;
  detailsWidth?: CornerWidth;
  flowing?: boolean;
};

export function BoardCardStack({ id, situation, evidence, open, onOpenChange, resize, detailsWidth, flowing }: BoardCardStackProps) {
  const [cardOrder, setCardOrder] = useState<BoardCardName[]>(["situation", "evidence"]);
  const hasEvidence = evidence != null;
  const visibleCards = hasEvidence ? cardOrder : cardOrder.filter((name) => name === "situation");
  const reorder = useReorder({
    ids: visibleCards,
    onReorder: (ids) => setCardOrder(ids as BoardCardName[]),
    disabled: !hasEvidence,
    getLabel: (name) => cardLabels[name as BoardCardName],
  });

  return (
    <div {...reorder.getContainerProps()} id={id} className="fd-workspace-card-stack">
      {visibleCards.map((name) => {
        const label = cardLabels[name];
        const cardId = `${id}-${name}`;
        const cardSize = resize(name);
        return (
          <Card key={name} {...reorder.getItemProps(name)} id={cardId} role="region" aria-label={label}
            radius="lg" padding="none" bordered className="fd-workspace-detail-card" data-open={open[name] ? "" : undefined}
            data-fixed-height={!flowing && cardSize.value ? "" : undefined}
            style={!flowing && cardSize.value ? { "--fd-workspace-card-height": `${cardSize.value}px` } as CSSProperties : undefined}>
            <Collapsible open={open[name]} onOpenChange={(value) => onOpenChange(name, value)}
              keepMounted={name === "situation"} className="fd-workspace-card-fold">
              <div className="fd-workspace-card-header">
                {/* The 24px grip sits 8px inside the card's 20px corners. */}
                {hasEvidence && <Button {...reorder.getHandleProps(name)} variant="ghost" size="sm" radius={12}
                  className="size-[var(--sw-space-6)] shrink-0 cursor-grab touch-none" iconOnly title={`Reorder ${label}`}
                  leading={<Icon name="grip" width={16} height={16} />} />}
                <h3 className="min-w-0 flex-1 text-sm font-semibold">
                  <CollapsibleTrigger className="mx-0 w-full justify-between px-1">{label}</CollapsibleTrigger>
                </h3>
              </div>
              <CollapsiblePanel className="fd-workspace-card-body">
                {name === "situation" ? situation : evidence}
              </CollapsiblePanel>
            </Collapsible>
            {!flowing && open[name] && <WorkspaceResizeHandle {...cardSize} target={cardId} label={`Resize ${label} card`}
              axis="height" getBounds={cardBounds} cornerWidth={detailsWidth} />}
          </Card>
        );
      })}
      {reorder.dropIndicator}
      {reorder.overlay}
    </div>
  );
}
