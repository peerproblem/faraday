import { describe, expect, it, vi } from "vitest";
import type { Exec } from "../db/pool";
import { dailyLimit, reserveReadsIn } from "./social";

function db(reads: number[]): Exec {
  return { run: vi.fn(async () => ({ insertId: 0, affectedRows: 1 })), all: vi.fn(),
    one: vi.fn().mockImplementation(async () => ({ read_count: reads.shift() ?? 0 })) };
}
describe("social budget reservation", () => {
  it("reserves before spending, locks global then board and keys by UTC day", async () => {
    const store = db([90, 10]);
    expect(await reserveReadsIn(store, "b", 10, Date.parse("2026-11-14T23:59:59Z"), 20, 100)).toBe(true);
    expect(vi.mocked(store.one).mock.calls.map((c) => c[1])).toEqual([["2026-11-14", "global"], ["2026-11-14", "board:b"]]);
    expect(store.run).toHaveBeenLastCalledWith(expect.stringContaining("read_count + ?"), [10, "2026-11-14", "global", "board:b"]);
  });
  it.each([[91, 0], [0, 11]])("blocks global or board exhaustion without incrementing either counter", async (g, b) => {
    const store = db([g, b]);
    expect(await reserveReadsIn(store, "b", 10, 0, 20, 100)).toBe(false);
    expect(vi.mocked(store.run).mock.calls.some(([sql]) => sql.includes("read_count +"))).toBe(false);
  });
  it("fails closed on invalid env limits and supports zero as an off switch", () => {
    expect(dailyLimit(undefined, 20)).toBe(20);
    for (const x of ["0", "nope", "-1", "Infinity", "1.5"]) expect(dailyLimit(x, 20)).toBe(0);
  });
});
