import { z } from "zod";
import { isNaturalDisaster } from "./common";
import { widgetTypes } from "./widgets";

const cardContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary") }),
  z.object({ kind: z.literal("widget"), type: z.enum(widgetTypes), key: z.string().min(1).max(256).optional() }),
  z.object({ kind: z.literal("incident-status") }),
  z.object({ kind: z.literal("automatic-chart") }),
  z.object({ kind: z.literal("official-tally"), chart: z.enum(["none", "auto", "donut", "bars"]) }),
  z.object({ kind: z.literal("status-chart"), chart: z.enum(["donut", "bars"]), key: z.string().min(1).max(256).optional() }),
]);

const cardSettingsSchema = z.object({
  title: z.string().trim().min(1).max(100),
  open: z.boolean(),
  contents: z.array(cardContentSchema).max(12),
});
const boardCardSchema = cardSettingsSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,36}$/).refine((id) => id !== "layout-editor"),
  placement: z.enum(["right", "half", "full"]),
});

const mapCameraSchema = z.object({
  lat: z.number().min(-85).max(85),
  lon: z.number().min(-180).max(180),
  zoom: z.number().min(1).max(18),
});
const mapRegionSchema = mapCameraSchema.extend({
  label: z.string().trim().min(1).max(64),
  areas: z.array(z.string().trim().min(1).max(80)).max(20),
  inset: mapCameraSchema.extend({ label: z.string().trim().min(1).max(64) }).optional(),
});

/** Administrator-editable layout settings. Boards copy these settings when a template is applied. */
export const boardLayoutSchema = z.object({
  layout: z.enum(["map", "grid"]),
  timelineOpen: z.boolean(),
  mapDetails: z.enum(["overlay", "aside"]).optional(),
  mapCard: cardSettingsSchema.optional(),
  mapRegions: z.array(mapRegionSchema).max(6)
    .refine((regions) => new Set(regions.map(({ label }) => label.toLowerCase())).size === regions.length, "Map region names must be distinct").optional(),
  officialDomains: z.array(z.string().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/).max(253)).max(12).optional(),
  evidenceOpen: z.boolean(),
  // Absent uses the original timeline when available; null explicitly hides the sidebar.
  sidebar: cardSettingsSchema.nullable().optional(),
  cards: z.array(boardCardSchema).max(20).refine((cards) => new Set(cards.map(({ id }) => id)).size === cards.length, "Card IDs must be distinct").optional(),
});
export type BoardLayout = z.infer<typeof boardLayoutSchema>;
export type BoardMapRegion = z.infer<typeof mapRegionSchema>;
export type BoardLayoutCard = z.infer<typeof boardCardSchema>;
export type BoardCardSettings = z.infer<typeof cardSettingsSchema>;
export type BoardCardContent = z.infer<typeof cardContentSchema>;
export type BoardLayoutTemplate = { id: string; name: string; settings: BoardLayout; rev: number };
export type BoardLayoutAssignment = { templateId: string | null; settings: BoardLayout };
export type BoardLayoutState = { assignment: BoardLayoutAssignment | null; rev: number };

export function incidentReporting(settings: BoardLayout | null, category?: string | null) {
  const mapContents = settings?.layout === "map" ? [...(settings.sidebar?.contents ?? []), ...(settings.mapCard?.contents ?? [])] : [];
  const contents = [...mapContents, ...(settings?.cards ?? []).flatMap((card) => card.contents)];
  const hasStatus = contents.some((content) => content.kind === "incident-status");
  const hasTally = contents.some((content) => content.kind === "official-tally");
  const showOverview = isNaturalDisaster(category) && settings?.layout !== "grid" && settings?.cards === undefined;
  const overview = showOverview && (!hasStatus || !hasTally) ? { status: !hasStatus, tally: !hasTally } : undefined;
  return {
    status: hasStatus || !!overview?.status,
    tally: hasTally || !!overview?.tally,
    domains: settings?.officialDomains ?? [],
    overview,
  };
}

/** Resolved renderer settings, safe to share with anyone viewing a board. */
export type BoardPresentation = {
  workspace: boolean;
  marketPrices?: true;
  cardsOnMap?: boolean;
  timelineOpen?: boolean;
  evidenceOpen?: boolean;
  incidentOverview?: { status: boolean; tally: boolean };
  sidebar?: BoardLayout["sidebar"];
  mapCard?: BoardLayout["mapCard"];
  mapRegions?: BoardLayout["mapRegions"];
  cards?: BoardLayoutCard[];
};

export function resolveBoardPresentation(settings: BoardLayout | null, marketPrices = false, category?: string | null): BoardPresentation | undefined {
  const incidentOverview = incidentReporting(settings, category).overview;
  if (settings?.layout === "map") {
    return { workspace: true, cardsOnMap: settings.mapDetails !== "aside", timelineOpen: settings.timelineOpen, evidenceOpen: settings.evidenceOpen,
      sidebar: settings.sidebar, cards: settings.cards, mapCard: settings.mapCard, mapRegions: settings.mapRegions, incidentOverview };
  }
  if (settings) return { workspace: false, cards: settings.cards };
  if (marketPrices) return { workspace: false, marketPrices: true };
  return incidentOverview ? { workspace: true, incidentOverview } : undefined;
}
