// Props every widget component receives (guide P5-3).
import type { BoardEvent, BoardStatus, BoardTier, Source, Widget, WidgetDataMap, WidgetType } from "@/lib/spec";

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
  fillMap?: boolean;
  wrapSourceTitles?: boolean;
  collapseSourceGroups?: boolean;
  compactTrendAxis?: boolean;
  cyberPresentation?: boolean;
  outagePresentation?: boolean;
};
