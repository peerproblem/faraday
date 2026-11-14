import { useMemo, useState } from "react";

/** The ids that were not there when the component mounted: what arrived while the person was looking. */
export function useArrivals(ids: string[]): Set<string> {
  const [known] = useState(() => new Set(ids));
  return useMemo(() => new Set(ids.filter((id) => !known.has(id))), [ids, known]);
}
