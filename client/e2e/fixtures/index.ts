import type { BoardView, RunView } from "../../src/lib/spec";
import cyber from "./cyber.json";
import flood from "./flood.json";
import outage from "./outage.json";
import strike from "./strike.json";

export type Fixture = { board: BoardView; run: RunView };

// JSON widens literal types, so the files are cast once here. They follow the BoardView contract.
const all = { flood, outage, cyber, strike } as unknown as Record<string, Fixture>;

export const fixtureNames = Object.keys(all);

export function getFixture(name: string): Fixture | null {
  if (!Object.hasOwn(all, name)) return null;
  const fx = structuredClone(all[name]);
  // Saved before topics existed: every fixture is a shared topic.
  fx.board = { ...fx.board, origin: fx.board.origin ?? "system", topicState: fx.board.topicState ?? "active" };
  return fx;
}
