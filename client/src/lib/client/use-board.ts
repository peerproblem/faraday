"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@ui-sdk/react/toast";
import { api } from "@/lib/config";
import type { BoardEvent, BoardSpec, BoardView } from "@/lib/spec";

type StreamMsg =
  | { type: "hello" }
  | { type: "board"; version: number; status: string }
  | { type: "partial"; spec: Partial<BoardSpec> }
  | { type: "event"; event: BoardEvent };

export function useBoard(initial: BoardView) {
  const [board, setBoard] = useState<BoardView>(initial);
  const [partial, setPartial] = useState<Partial<BoardSpec> | null>(null);
  const [connected, setConnected] = useState(false);
  const versionRef = useRef(initial.version);

  const refetch = useCallback(async () => {
    const res = await fetch(api(`/api/boards/${initial.id}`), { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as BoardView;
    versionRef.current = next.version;
    setBoard(next);
    if (next.spec && next.status !== "composing") setPartial(null);
  }, [initial.id]);

  useEffect(() => {
    const es = new EventSource(api(`/api/boards/${initial.id}/stream`));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as StreamMsg;
      if (msg.type === "hello") {
        setConnected(true);
        void refetch();
      } else if (msg.type === "partial") {
        setPartial(msg.spec);
      } else if (msg.type === "board") {
        void refetch();
      } else if (msg.type === "event") {
        setBoard((b) => ({ ...b, events: [msg.event, ...b.events.filter((x) => x.id !== msg.event.id)] }));
        if (msg.event.kind === "update") toast("Board updated", { description: msg.event.message });
        if (msg.event.kind === "change") toast("Monitor fired", { description: msg.event.message });
      }
    };
    return () => es.close();
  }, [initial.id, refetch]);

  return { board, partial, connected, refetch };
}
