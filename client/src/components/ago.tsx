"use client";

import { useSyncExternalStore } from "react";
import { ago } from "@/lib/time";

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    queueMicrotask(fn);
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useCurrentTime() {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}

export function Ago({ t }: { t: string | number | null | undefined }) {
  const current = useCurrentTime();
  return <span>{current === null ? "…" : ago(t, current)}</span>;
}
