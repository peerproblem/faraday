// Props every widget component receives (guide P5-3).
import type { BoardEvent, BoardStatus, BoardTier, Source, Widget, WidgetDataMap, WidgetFilter, WidgetType } from "@/lib/spec";

export type WidgetProps<T extends WidgetType = WidgetType> = {
  widget: Widget & { type: T };
  data: WidgetDataMap[T] | undefined;
  /** Sources by id, for citation chips. */
  sources: Map<string, Source>;
  allSources: Source[];
  events: BoardEvent[];
  status: BoardStatus;
  tier: BoardTier;
  building: boolean;
  mapFocus?: boolean;
  /** A personal dashboard's display filter for this widget. Only narrows what is shown; the data is unchanged. */
  filter?: Extract<WidgetFilter, { kind: T }>;
};
