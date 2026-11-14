"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { PersonalLayout, PersonalViewState } from "@/lib/spec";
import { transitionLayout } from "./view-transition";
import { ApiError, saveView } from "./views-api";

export const SAVE_DEBOUNCE_MS = 300;

/**
 * A person's layout for one topic. Changes show at once (inside a view transition) and are saved 300 ms after the
 * last one. Saves carry the revision they build on; a 409 means another tab saved first, so its layout is shown.
 */
export function useLayout(boardId: string, initial: PersonalViewState | null) {
  const [layout, setLayout] = useState<PersonalLayout | null>(initial?.layout ?? null);
  const [saving, setSaving] = useState(false);
  const rev = useRef(initial?.rev ?? 0);
  const pending = useRef<PersonalLayout | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const show = useCallback((next: PersonalLayout | null) => transitionLayout(() => setLayout(next)), []);

  // Sends pending changes one at a time until none are left.
  const flush = useCallback(async () => {
    timer.current = null;
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    while (pending.current) {
      const body = pending.current;
      pending.current = null;
      try {
        const r = await saveView(boardId, body, rev.current);
        rev.current = r.rev;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const b = e.body as { layout?: PersonalLayout | null; rev?: number };
          if (typeof b.rev === "number") rev.current = b.rev;
          pending.current = null;
          show(b.layout ?? null);
          toast("Your dashboard changed in another tab", { description: "Showing the latest version." });
        } else {
          toast.danger("Could not save your dashboard", { description: (e as Error).message });
        }
      }
    }
    inFlight.current = false;
    setSaving(false);
  }, [boardId, show]);

  // Leaving the page (or this dashboard) inside the debounce window still saves the last change.
  useEffect(() => {
    const flushPending = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      void flush();
    };
    window.addEventListener("pagehide", flushPending);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      flushPending();
    };
  }, [flush]);

  /** Shows a layout the person made and saves it shortly after. */
  const change = useCallback(
    (next: PersonalLayout) => {
      show(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush, show],
  );

  /** Shows a layout the server already saved (a prompt edit or an undo). */
  const replace = useCallback(
    (next: PersonalLayout | null, nextRev: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      rev.current = nextRev;
      show(next);
    },
    [show],
  );

  /** Saves a pending change now. Call before a server-side edit, which builds on the saved layout. */
  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await flush();
  }, [flush]);

  return { layout, saving, change, replace, saveNow, rev: () => rev.current };
}
