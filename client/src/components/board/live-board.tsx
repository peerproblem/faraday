"use client";

import { OverlayHost } from "@/components/ui/toast";
import { useBoard } from "@/lib/client/use-board";
import { api } from "@/lib/config";
import type { ReactNode } from "react";
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

/** The shared (baseline) board: data updates are highlighted, the layout never animates. */
export function LiveBoard({ initial, live = true, actions, workspace, wildfireOverview, workspaceNavigation }: {
  initial: BoardView;
  live?: boolean;
  actions?: ReactNode;
  workspace?: boolean;
  wildfireOverview?: boolean;
  workspaceNavigation?: ReactNode;
}) {
  const { board, partial, spec, data, connected, refresh, updatedAt } = useLiveBoard(initial, { live });
  const mapWorkspace = workspace && spec?.widgets.some((widget) => widget.type === "map");
  return (
    <>
      <Board
        boardId={live ? board.id : undefined}
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
        onRefresh={live && !mapWorkspace ? refresh : undefined}
        updatedAt={updatedAt}
        actions={actions}
        workspace={workspace}
        cardsOnMap={board.presentation?.cardsOnMap}
        mapCard={board.presentation?.mapCard}
        mapRegions={board.presentation?.mapRegions}
        defaultTimelineOpen={board.presentation?.timelineOpen}
        defaultEvidenceOpen={board.presentation?.evidenceOpen}
        incidentOverview={board.presentation?.incidentOverview}
        sidebarSettings={board.presentation?.sidebar}
        configuredCards={board.presentation?.cards}
        wildfireOverview={wildfireOverview}
        workspaceNavigation={workspaceNavigation}
        workspaceKey={`shared:${board.id}`}
      />
      <BoardToasts />
      <AgentBridge />
    </>
  );
}
