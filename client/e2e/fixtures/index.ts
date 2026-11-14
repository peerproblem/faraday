import type { BoardView, RunView } from "../../src/lib/spec";
import cyber from "./cyber.json";
import flood from "./flood.json";
import outage from "./outage.json";

export type Fixture = { board: BoardView; run: RunView };

// JSON widens literal types, so the files are cast once here. They follow the BoardView contract.
const all = { flood, outage, cyber } as unknown as Record<string, Fixture>;

export const fixtureNames = Object.keys(all);

export function getFixture(name: string): Fixture | null {
  return Object.hasOwn(all, name) ? structuredClone(all[name]) : null;
}
