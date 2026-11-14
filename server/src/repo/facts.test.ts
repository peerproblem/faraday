import { beforeAll, describe, expect, it } from "vitest";
import { all, run } from "../db/pool";
import { mergeFacts } from "../pipeline/merge";
import type { StagedFact } from "../spec";
import { useTestDb } from "../test/db";
import { applyMerge, listFacts, metricHistory, saveRejected, updatePlaceCoords } from "./facts";

const db = useTestDb("repo_facts");
const BOARD = "bfacts1";

function staged(over: Partial<StagedFact>): StagedFact {
  return {
    kind: "metric",
    key: "deaths",
    sourceId: "s1",
    quote: "At least 12 people died",
    asOf: "2026-10-30T10:00:00Z",
    payload: { valueText: "12", valueNum: 12, unit: null, scope: null },
    sourceType: "news",
    relevance: 0.8,
    valueNum: 12,
    ...over,
  } as StagedFact;
}

describe.skipIf(!db.enabled)("repo/facts", () => {
  beforeAll(async () => {
    const now = Date.now();
    await run(`INSERT INTO boards (id, slug, prompt, status, created_at, updated_at) VALUES (?, ?, 'p', 'live', ?, ?)`, [BOARD, "facts-test", now, now]);
  });

  it("applies a merge, then supersedes and confirms in a second merge", async () => {
    const first = await applyMerge(
      BOARD,
      7,
      mergeFacts(
        [],
        [
          staged({}),
          staged({ kind: "place", key: "paiporta", payload: { name: "Paiporta", placeKind: "impact", note: "" }, valueNum: null }),
          staged({ asOf: "2026-10-29T10:00:00Z", payload: { valueText: "8", valueNum: 8, unit: null, scope: null }, valueNum: 8, sourceId: "s3" }),
        ],
        { keyAliases: {}, eventSameAs: {} },
      ),
    );
    expect(first).toHaveLength(3);
    expect(first.map((f) => f.status)).toEqual(["active", "active", "superseded"]);
    expect(first[2].supersededBy).toBe(first[0].id);
    expect(first[0].key).toBe("deaths");

    const active = await listFacts(BOARD);
    expect(active.map((f) => f.key).sort()).toEqual(["deaths", "paiporta"]);
    const deaths = active.find((f) => f.key === "deaths")!;
    expect(deaths).toMatchObject({ kind: "metric", valueNum: 12, verified: true, runId: 7, sourceIds: ["s1"] });

    const second = mergeFacts(
      active,
      [
        staged({ sourceId: "s2", asOf: "2026-10-30T11:00:00Z" }),
        staged({ asOf: "2026-10-31T09:00:00Z", payload: { valueText: "15", valueNum: 15, unit: null, scope: null }, valueNum: 15, sourceId: "s4" }),
      ],
      { keyAliases: {}, eventSameAs: {} },
    );
    const inserted = await applyMerge(BOARD, 8, second);
    expect(inserted).toHaveLength(1);

    const after = await listFacts(BOARD, { kinds: ["metric"] });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ valueNum: 15, sourceIds: ["s4"] });
    const old = (await listFacts(BOARD, { status: ["superseded"], kinds: ["metric"] })).find((f) => f.id === deaths.id)!;
    expect(old.sourceIds).toEqual(["s1", "s2"]);
    expect(old.asOf).toBe("2026-10-30T11:00:00Z");
    expect(old.supersededBy).toBe(inserted[0].id);

    const hist = await metricHistory(BOARD);
    expect(hist.map((f) => f.valueNum)).toEqual([12, 8, 15]);
  });

  it("stores rejected facts with the reason", async () => {
    await saveRejected(BOARD, 9, [{ fact: staged({ key: "bad", quote: "nope" }), reason: "quote not found in source" }]);
    const rows = await listFacts(BOARD, { status: ["rejected"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verified: false, key: "bad" });
    expect((rows[0].payload as unknown as { _rejected: string })._rejected).toBe("quote not found in source");
    expect(await listFacts(BOARD, { kinds: ["metric"] })).toHaveLength(1);
  });

  it("updates place coordinates", async () => {
    const place = (await listFacts(BOARD, { kinds: ["place"] }))[0];
    await updatePlaceCoords(place.id, 39.43, -0.42);
    const p = (await listFacts(BOARD, { kinds: ["place"] }))[0].payload as { lat: number; lon: number; name: string };
    expect(p).toMatchObject({ lat: 39.43, lon: -0.42, name: "Paiporta" });
  });

  it("inserts more rows than one chunk with matching ids", async () => {
    const many = Array.from({ length: 230 }, (_, i) =>
      staged({ kind: "event", key: `e-${i}`, payload: { title: `Event ${i}`, detail: "", importance: "low" }, valueNum: null, asOf: null }),
    );
    const inserted = await applyMerge(BOARD, 10, mergeFacts([], many, { keyAliases: {}, eventSameAs: {} }));
    expect(inserted).toHaveLength(230);
    const rows = await all<{ id: number; fkey: string }>(`SELECT id, fkey FROM facts WHERE board_id = ? AND kind = 'event' ORDER BY id`, [BOARD]);
    expect(rows.map((r) => Number(r.id))).toEqual(inserted.map((f) => f.id));
    expect(rows[229].fkey).toBe("event:e-229");
  });
});
