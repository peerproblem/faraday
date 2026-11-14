"use client";

import { flushSync } from "react-dom";

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs a layout change inside a same-document View Transition, so each widget glides from its old place and size to
 * the new one (every WidgetFrame has its own view-transition-name). Without support, or with reduced motion, the change
 * is applied at once. Maps are told to resize once the transition is over: their canvas is stretched during it.
 */
export function transitionLayout(update: () => void): void {
  const doc = typeof document !== "undefined" ? (document as ViewTransitionDoc) : null;
  if (!doc?.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  const t = doc.startViewTransition(() => flushSync(update));
  void t.finished.finally(() => window.dispatchEvent(new Event("resize")));
}

/** A view-transition-name made from a widget key ("table:road-closures" -> "fd-w-table-road-closures"). */
export const transitionName = (key: string) => `fd-w-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
