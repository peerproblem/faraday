"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/config";
import type { BoardView, StreamMsg } from "@/lib/spec";
import { applyMessage, visible, type BoardState } from "./board-state";

/**
 * Keeps a board up to date over the SSE v2 stream (guide P4-4). Messages are applied as they come; the
 * whole board is only fetched again when a version gap shows that messages were missed. EventSource
 * reconnects by itself and sends Last-Event-ID, so the server can replay the events in between.
 */
export function useBoard(initial: BoardView, opts?: { live?: boolean }) {
  const live = opts?.live ?? true;
  const [state, setState] = useState<BoardState>({ board: initial, partial: null });
  const [connected, setConnected] = useState(false);
  // The stream handler needs the latest state to decide on a refetch, so it keeps its own copy in step with setState.
  const stateRef = useRef<BoardState>({ board: initial, partial: null });

  const refetch = useCallback(async () => {
    const res = await fetch(api(`/api/boards/${initial.id}`), { cache: "no-store", credentials: "include" });
    if (!res.ok) return;
    const board = (await res.json()) as BoardView;
    const prev = stateRef.current;
    const next = { board, partial: board.status === "live" || board.status === "error" ? null : prev.partial };
    stateRef.current = next;
    setState(next);
  }, [initial.id]);

  useEffect(() => {
    if (!live) return;
    const es = new EventSource(api(`/api/boards/${initial.id}/stream`), { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      let msg: StreamMsg;
      try {
        msg = JSON.parse(e.data) as StreamMsg;
      } catch {
        return;
      }
      if (msg.type === "hello") setConnected(true);
      const r = applyMessage(stateRef.current, msg);
      stateRef.current = r.state;
      setState(r.state);
      if (r.refetch) void refetch();
      if (msg.type === "event") {
        if (msg.event.kind === "update") toast("Board updated", { description: msg.event.message });
        if (msg.event.kind === "change") toast("New development detected", { description: msg.event.message });
      }
    };
    return () => es.close();
  }, [initial.id, live, refetch]);

  const shown = useMemo(() => visible(state), [state]);
  return { board: state.board, partial: state.partial, spec: shown.spec, data: shown.data, connected, refetch };
}
