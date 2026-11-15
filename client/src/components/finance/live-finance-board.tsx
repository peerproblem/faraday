"use client";

import "./finance.css";
import type { ReactNode } from "react";
import { AgentBridge } from "@/components/board/agent-bridge";
import { BoardToasts, useLiveBoard } from "@/components/board/live-board";
import type { MarketData } from "@/lib/market";
import type { BoardView } from "@/lib/spec";
import { FinanceBoard } from "./finance-board";

/** The shared board page for boards with the finance template, kept live over the board stream. */
export function LiveFinanceBoard({ initial, actions, market }: { initial: BoardView; actions?: ReactNode; market: MarketData | null }) {
  const { board, spec, data, connected, refresh } = useLiveBoard(initial);
  return (
    <>
      <FinanceBoard board={board} spec={spec} data={data} connected={connected} onRefresh={refresh} actions={actions} market={market} />
      <BoardToasts />
      <AgentBridge />
    </>
  );
}
