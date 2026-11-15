import { emptyLayout, type BoardDesign, type BoardSpecV2, type PersonalLayout } from "@/lib/spec";

/**
 * The design a new personal dashboard starts with: the one the shared board shows. Shared boards with a map draw the
 * map monitor; finance boards and boards without a map keep the card grid.
 */
export function defaultDesign(spec: BoardSpecV2 | null | undefined): BoardDesign {
  if (!spec || spec.template === "finance") return "standard";
  return spec.widgets.some((w) => w.type === "map") ? "map-overlay" : "standard";
}

/** An unchanged personal dashboard (the baseline as it is) in the shared board's design. */
export const defaultLayout = (board: { version: number; spec: BoardSpecV2 | null | undefined }): PersonalLayout => ({
  ...emptyLayout(board.version),
  design: defaultDesign(board.spec),
});
