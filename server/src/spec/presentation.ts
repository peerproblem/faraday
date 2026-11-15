import { z } from "zod";
import { widgetTypes } from "./widgets";

const cardContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary") }),
  z.object({ kind: z.literal("widget"), type: z.enum(widgetTypes), key: z.string().min(1).max(256).optional() }),
  z.object({ kind: z.literal("status-chart"), chart: z.enum(["donut", "bars"]), key: z.string().min(1).max(256).optional() }),
]);

const boardCardSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,36}$/).refine((id) => id !== "layout-editor"),
  title: z.string().trim().min(1).max(100),
  placement: z.enum(["right", "half", "full"]),
  open: z.boolean(),
  contents: z.array(cardContentSchema).max(12),
});

/** Administrator-editable layout settings. Boards copy these settings when a template is applied. */
export const boardLayoutSchema = z.object({
  layout: z.enum(["map", "grid"]),
  timelineOpen: z.boolean(),
  evidenceOpen: z.boolean(),
  cards: z.array(boardCardSchema).max(20).refine((cards) => new Set(cards.map(({ id }) => id)).size === cards.length, "Card IDs must be distinct").optional(),
});
export type BoardLayout = z.infer<typeof boardLayoutSchema>;
export type BoardLayoutCard = z.infer<typeof boardCardSchema>;
export type BoardCardContent = z.infer<typeof cardContentSchema>;
export type BoardLayoutTemplate = { id: string; name: string; settings: BoardLayout; rev: number };
export type BoardLayoutAssignment = { templateId: string | null; settings: BoardLayout };
export type BoardLayoutState = { assignment: BoardLayoutAssignment | null; rev: number };

/** Resolved renderer settings, safe to share with anyone viewing a board. */
export type BoardPresentation = {
  workspace: boolean;
  marketPrices?: true;
  cardsOnMap?: boolean;
  timelineOpen?: boolean;
  evidenceOpen?: boolean;
  cards?: BoardLayoutCard[];
};

export function resolveBoardPresentation(settings: BoardLayout | null, marketPrices = false): BoardPresentation | undefined {
  if (settings?.layout === "map") {
    return { workspace: true, cardsOnMap: true, timelineOpen: settings.timelineOpen, evidenceOpen: settings.evidenceOpen, cards: settings.cards };
  }
  if (settings) return { workspace: false, cards: settings.cards };
  return marketPrices ? { workspace: false, marketPrices: true } : undefined;
}
