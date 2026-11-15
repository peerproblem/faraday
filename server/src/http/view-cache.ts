import { createHash } from "node:crypto";
import type { BoardView } from "../spec";

/** Short-lived cache of board views. Entries are dropped when the board publishes anything. */
export function createViewCache(ttlMs = 5_000) {
  const entries = new Map<string, { view: BoardView; at: number }>();
  return {
    get(id: string, now = Date.now()) {
      const e = entries.get(id);
      if (!e) return null;
      if (now - e.at > ttlMs) {
        entries.delete(id);
        return null;
      }
      return e.view;
    },
    set(id: string, view: BoardView, now = Date.now()) {
      entries.set(id, { view, at: now });
      if (entries.size > 500) entries.delete(entries.keys().next().value!);
    },
    invalidate(id: string) {
      entries.delete(id);
    },
    clear() {
      entries.clear();
    },
  };
}

export function etagFor(view: Pick<BoardView, "version" | "status" | "tier" | "presentation" | "displaySnapshot">, sourceRevision?: number) {
  const p = view.presentation;
  const layout = p ? `-${createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16)}` : "";
  const saved = view.displaySnapshot ? `-saved-${view.displaySnapshot.version}-${view.displaySnapshot.capturedAt}` : "";
  const sources = sourceRevision === undefined ? "" : `-sources-${sourceRevision}`;
  return `"v${view.version}-${view.status}-${view.tier}${layout}${saved}${sources}"`;
}

export function etagMatches(ifNoneMatch: string | undefined, etag: string) {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((s) => s.trim().replace(/^W\//, ""))
    .some((s) => s === etag || s === "*");
}
