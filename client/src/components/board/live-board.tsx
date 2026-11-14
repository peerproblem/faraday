"use client";

import { useEffect } from "react";
import { Toast, ToastDescription, ToastRegion, ToastTitle } from "@ui-sdk/react/toast";
import { createAgent, registerTools } from "@ui-sdk/react/agent";
import type { BoardView } from "@/lib/spec";
import { useBoard } from "@/lib/client/use-board";
import { api } from "@/lib/config";
import { Board } from "./board";

export function useLiveBoard(initial: BoardView) {
  const live = useBoard(initial);
  const refresh = async () => {
    await fetch(api(`/api/boards/${initial.id}/refresh`), { method: "POST", credentials: "include" });
  };
  return { ...live, refresh };
}

export function BoardToasts() {
  return (
    <ToastRegion data-agent-hidden>
      {() => (
        <Toast>
          <ToastTitle />
          <ToastDescription />
        </Toast>
      )}
    </ToastRegion>
  );
}

export function AgentBridge() {
  useEffect(() => {
    const agent = createAgent({ allow: () => true });
    return registerTools(agent, { allow: () => true });
  }, []);
  return null;
}

export function LiveBoard({ initial }: { initial: BoardView }) {
  const { board, partial, connected, refresh } = useLiveBoard(initial);
  return (
    <>
      <Board
        spec={partial ?? board.spec}
        sources={board.sources}
        events={board.events}
        status={board.status}
        connected={connected}
        lastPolledAt={board.lastPolledAt}
        onRefresh={refresh}
      />
      <BoardToasts />
      <AgentBridge />
    </>
  );
}
