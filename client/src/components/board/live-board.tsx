"use client";

import { OverlayHost } from "@/components/ui/toast";
import { useBoard } from "@/lib/client/use-board";
import { api } from "@/lib/config";
import type { ReactNode } from "react";
import type { BoardView } from "@/lib/spec";
import type { WildfireBoard } from "@/components/wildfire/boards";
import { AgentBridge } from "./agent-bridge";
import { Board } from "./board";

const HOUTHI_BOARD_ID = "rq1focvq3j9e";

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
export function LiveBoard({ initial, live = true, actions, workspace, wildfire, strikeOverview, workspaceNavigation }: {
  initial: BoardView;
  live?: boolean;
  actions?: ReactNode;
  workspace?: boolean;
  wildfire?: WildfireBoard;
  strikeOverview?: boolean;
  workspaceNavigation?: ReactNode;
}) {
  const frozen = !!initial.displaySnapshot;
  const { board, partial, spec, data, connected, refresh, updatedAt } = useLiveBoard(initial, { live: live && !frozen });
  const capturedAt = board.displaySnapshot?.capturedAt;
  const displaySpec = board.displaySnapshot?.spec ?? spec;
  const houthiBriefing = !!workspace && board.id === HOUTHI_BOARD_ID;
  const mapWorkspace = workspace && displaySpec?.widgets.some((widget) => widget.type === "map");
  return (
    <>
      <Board
        boardId={live || houthiBriefing ? board.id : undefined}
        spec={displaySpec}
        data={board.displaySnapshot?.data ?? data}
        specVersion={board.specVersion}
        title={board.title}
        prompt={board.prompt}
        sources={capturedAt === undefined ? board.sources : board.sources.filter((source) => source.fetchedAt <= capturedAt)}
        events={capturedAt === undefined ? board.events : board.events.filter((event) => event.ts <= capturedAt)}
        status={board.status}
        tier={board.tier}
        stage={partial?.stage}
        connected={connected}
        lastPolledAt={capturedAt ?? board.lastPolledAt}
        snapshotAt={capturedAt}
        onRefresh={live && !frozen && !mapWorkspace ? refresh : undefined}
        updatedAt={updatedAt}
        actions={actions}
        workspace={workspace}
        stormBriefing={board.presentation?.stormBriefing}
        cardsOnMap={board.presentation?.cardsOnMap}
        mapCard={board.presentation?.mapCard}
        mapRegions={board.presentation?.mapRegions}
        defaultTimelineOpen={board.presentation?.timelineOpen}
        defaultEvidenceOpen={board.presentation?.evidenceOpen}
        overviewStatusChart={board.presentation?.overviewStatusChart}
        incidentOverview={board.presentation?.incidentOverview}
        sidebarSettings={board.presentation?.sidebar}
        configuredCards={board.presentation?.cards}
        wildfire={wildfire}
        strikeOverview={strikeOverview}
        workspaceNavigation={workspaceNavigation}
        houthiBriefing={houthiBriefing}
        workspaceKey={`shared:${board.id}`}
      />
      <BoardToasts />
      <AgentBridge />
    </>
  );
}
