import type { BoardPresentation, BoardView } from "./spec";
import { finlandOfficialSnapshot, finlandSnapshotCopy } from "./finland-snapshot";

const boards: Record<string, { version: number; presentation: BoardPresentation; sourceRevision?: number; projectSnapshot?: (view: BoardView) => BoardView; cardCopy?: { headline: string; prompt: string } }> = {
  oznxapju2rna: {
    version: 2,
    sourceRevision: 2,
    projectSnapshot: finlandOfficialSnapshot,
    cardCopy: finlandSnapshotCopy,
    presentation: {
      workspace: true, cardsOnMap: true, timelineOpen: true, evidenceOpen: true,
      overviewStatusChart: "table:temporary-restrictions",
    },
  },
  ps92ji01jll9: {
    version: 1,
    presentation: {
      workspace: true, cardsOnMap: false, timelineOpen: true, evidenceOpen: true,
      mapRegions: [
        {
          label: "Portugal & Madeira", areas: ["Portugal", "Madeira", "Porto Santo"], lat: 39.55, lon: -8.05, zoom: 5.6,
          inset: { label: "Madeira", lat: 32.76, lon: -16.95, zoom: 8.55 },
        },
        { label: "Southern Europe", areas: [], lat: 41.1, lon: 0.8, zoom: 4 },
      ],
      mapCard: { title: "Recorded warnings", open: true, contents: [{ kind: "widget", type: "alert-list", key: "alert-list" }] },
      cards: [
        { id: "reporting", title: "Flight cancellations", open: true, placement: "right",
          contents: [{ kind: "widget", type: "trend", key: "trend:flight-cancellations" }] },
        { id: "impacts", title: "Recorded impacts", open: true, placement: "right", contents: [
          { kind: "widget", type: "narrative", key: "narrative" },
          { kind: "widget", type: "stat-grid", key: "stat-grid" },
          { kind: "widget", type: "table", key: "table:affected-regions" },
          { kind: "widget", type: "table", key: "table:transport-closures" },
          { kind: "widget", type: "table", key: "table:school-and-public-closures" },
          { kind: "widget", type: "link-list", key: "link-list" },
        ] },
      ],
    },
  },
};

export const frozenBoardIds = Object.keys(boards);
export function frozenBoard(id: string) {
  return Object.hasOwn(boards, id) ? boards[id] : undefined;
}
