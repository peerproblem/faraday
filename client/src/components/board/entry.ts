import type { Widget } from "@/lib/spec";

/** One widget the board draws, with its stable key (widgetKeyOf: "map", "table:road-closures"). */
export type BoardEntry = { key: string; widget: Widget };
