"use client";

import { OverlayHost } from "@/components/ui/toast";
import { useBoard } from "@/lib/client/use-board";
import { api } from "@/lib/config";
import type { BoardView } from "@/lib/spec";
import { AgentBridge } from "./agent-bridge";
import { Board } from "./board";

export function useLiveBoard(initial: BoardView, opts?: { live?: boolean }) {
  const live = useBoard(initial, opts);
  const refresh = async () => {
    const res = await fetch(api(`/api/boards/${initial.id}/refresh`), { method: "POST", credentials: "include" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not check the web");
    }
  };
  return { ...live, refresh };
}

/** Hosts the toasts and confirm dialogs of a board page. */
export function BoardToasts() {
  return <OverlayHost />;
}

export function LiveBoard({ initial, live = true }: { initial: BoardView; live?: boolean }) {
  const { board, partial, spec, data, connected, refresh } = useLiveBoard(initial, { live });
  return (
    <>
      <Board
        spec={spec}
        data={data}
        specVersion={board.specVersion}
        title={board.title}
        prompt={board.prompt}
        sources={board.sources}
        events={board.events}
        status={board.status}
        tier={board.tier}
        stage={partial?.stage}
        connected={connected}
        lastPolledAt={board.lastPolledAt}
        onRefresh={live ? refresh : undefined}
      />
      <BoardToasts />
      <AgentBridge />
    </>
  );
}
