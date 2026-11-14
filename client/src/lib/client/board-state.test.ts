import { describe, expect, test } from "vitest";
import { getFixture } from "../../../e2e/fixtures";
import type { BoardView, StreamMsg } from "@/lib/spec";
import { applyMessage, visible, type BoardState } from "./board-state";

const start = (): BoardState => ({ board: getFixture("flood")!.board, partial: null });
const apply = (s: BoardState, ...msgs: StreamMsg[]) => {
  let refetch = false;
  for (const m of msgs) {
    const r = applyMessage(s, m);
    s = r.state;
    refetch ||= r.refetch;
  }
  return { s, refetch };
};

describe("applyMessage", () => {
  test("hello with the same version keeps the board, a different version asks for a refetch", () => {
    const s = start();
    expect(applyMessage(s, { type: "hello", version: s.board.version }).refetch).toBe(false);
    expect(applyMessage(s, { type: "hello", version: s.board.version + 1 }).refetch).toBe(true);
  });

  test("data for the next version merges only the widgets it carries", () => {
    const s = start();
    const v = s.board.version;
    const { s: next, refetch } = apply(s, {
      type: "data",
      version: v + 1,
      widgets: { w1: { sentences: [{ text: "New summary.", sources: ["s4"] }] } },
    });
    expect(refetch).toBe(false);
    expect(next.board.version).toBe(v + 1);
    expect(next.board.data!.widgets.w1).toEqual({ sentences: [{ text: "New summary.", sources: ["s4"] }] });
    expect(next.board.data!.widgets.w2).toBe(s.board.data!.widgets.w2);
    expect(next.board.data!.header).toBe(s.board.data!.header);
  });

  test("a version gap of two or more refetches instead of applying", () => {
    const s = start();
    const r = applyMessage(s, { type: "data", version: s.board.version + 2, widgets: {} });
    expect(r.refetch).toBe(true);
    expect(r.state).toBe(s);
  });

  test("stale data and spec messages are ignored", () => {
    const s = start();
    expect(applyMessage(s, { type: "data", version: s.board.version - 1, widgets: { w1: { sentences: [] } } }).state).toBe(s);
    expect(applyMessage(s, { type: "spec", version: s.board.version - 1, spec: { version: 2, widgets: [] } }).state).toBe(s);
  });

  test("spec for the next version replaces the widget list", () => {
    const s = start();
    const spec = { version: 2 as const, widgets: [{ id: "w1", type: "narrative" as const, title: "Now", span: "full" as const, bind: null, metrics: [] }] };
    const { s: next } = apply(s, { type: "spec", version: s.board.version + 1, spec });
    expect(next.board.spec).toEqual(spec);
    expect(next.board.version).toBe(s.board.version + 1);
  });

  test("data without a header on a board that has no data asks for a refetch", () => {
    const s = start();
    s.board = { ...s.board, data: null } as BoardView;
    expect(applyMessage(s, { type: "data", version: s.board.version + 1, widgets: {} }).refetch).toBe(true);
  });

  test("sources add new ones once and drop discarded ones", () => {
    const s = start();
    const added = { ...s.board.sources[0], id: "s99", url: "https://example.org/new" };
    const { s: next } = apply(s, { type: "sources", added: [added, added, s.board.sources[1]], discarded: ["s3"] });
    const ids = next.board.sources.map((x) => x.id);
    expect(ids.filter((id) => id === "s99")).toHaveLength(1);
    expect(ids).not.toContain("s3");
    expect(ids.filter((id) => id === "s2")).toHaveLength(1);
  });

  test("events go first, without duplicates, capped at 200", () => {
    let s = start();
    for (let i = 0; i < 250; i++) s = applyMessage(s, { type: "event", event: { id: 1000 + i, ts: i, kind: "info", message: `e${i}`, data: null } }).state;
    s = applyMessage(s, { type: "event", event: { id: 1249, ts: 0, kind: "info", message: "again", data: null } }).state;
    expect(s.board.events).toHaveLength(200);
    expect(s.board.events[0]).toMatchObject({ id: 1249, message: "again" });
    expect(s.board.events.filter((e) => e.id === 1249)).toHaveLength(1);
  });

  test("status updates the tier, and a finished build clears the partial", () => {
    let s = start();
    s = { board: { ...s.board, status: "composing" }, partial: { stage: "Writing" } };
    const building = applyMessage(s, { type: "status", status: "watching", tier: "hot" }).state;
    expect(building.partial).not.toBeNull();
    const live = applyMessage(building, { type: "status", status: "live", tier: "warm" }).state;
    expect(live.partial).toBeNull();
    expect(live.board.tier).toBe("warm");
  });

  test("partials accumulate and show on top of stored data", () => {
    let s = start();
    s = applyMessage(s, { type: "partial", stage: "Extracting facts", widgets: { w1: { sentences: [{ text: "Draft", sources: [] }] } } }).state;
    s = applyMessage(s, { type: "partial", header: { headline: { text: "Draft headline", sources: [] } } }).state;
    expect(s.partial?.stage).toBe("Extracting facts");
    const v = visible(s);
    expect(v.data!.header.headline!.text).toBe("Draft headline");
    expect(v.data!.header.title).toBe("Valencia Floods");
    expect(v.data!.widgets.w1).toEqual({ sentences: [{ text: "Draft", sources: [] }] });
    expect(v.data!.widgets.w2).toEqual(s.board.data!.widgets.w2);
  });

  test("a partial with a header on a board without data shows that header", () => {
    let s = start();
    s = { board: { ...s.board, data: null, spec: null }, partial: null };
    s = applyMessage(s, { type: "partial", spec: { version: 2, widgets: [] }, header: { title: "Building", crisisType: "flood", accent: "blue" } }).state;
    const v = visible(s);
    expect(v.spec).toEqual({ version: 2, widgets: [] });
    expect(v.data?.header.title).toBe("Building");
  });
});
