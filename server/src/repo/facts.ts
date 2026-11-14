// OWNER: F-PIPE-CORE. Fact store (guide P3-1). fkey in the DB is `${kind}:${key}`; Fact.key is the part after the kind.
import { all, json, run, tx, type Exec, type Param } from "../db/pool";
import type { ExtractedFact, Fact, FactKind, FactStatus } from "../spec";
import type { MergeResult, NewFactRow } from "../pipeline/merge";

type FactDbRow = {
  id: number;
  board_id: string;
  kind: FactKind;
  fkey: string;
  payload: string;
  value_num: number | null;
  as_of: string | null;
  source_ids: string;
  quote: string | null;
  quote_en?: string | null;
  verified: number;
  status: FactStatus;
  superseded_by: number | null;
  run_id: number | null;
  created_at: number;
};

const FKEY_MAX = 191;
const fkeyOf = (kind: FactKind, key: string) => `${kind}:${key}`.slice(0, FKEY_MAX);

function toFact(r: FactDbRow): Fact {
  return {
    id: Number(r.id),
    boardId: r.board_id,
    kind: r.kind,
    key: r.fkey.slice(r.kind.length + 1),
    payload: json(r.payload) as Fact["payload"],
    valueNum: r.value_num === null ? null : Number(r.value_num),
    asOf: r.as_of,
    sourceIds: json<string[]>(r.source_ids) ?? [],
    quote: r.quote,
    quoteEn: r.quote_en ?? null,
    verified: Number(r.verified) === 1,
    status: r.status,
    supersededBy: r.superseded_by === null ? null : Number(r.superseded_by),
    runId: r.run_id === null ? null : Number(r.run_id),
    createdAt: Number(r.created_at),
  };
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** Defaults to active facts of every kind. */
export async function listFacts(boardId: string, opts?: { status?: Fact["status"][]; kinds?: FactKind[] }): Promise<Fact[]> {
  const status = opts?.status?.length ? opts.status : (["active"] as FactStatus[]);
  const params: Param[] = [boardId, ...status];
  let sql = `SELECT * FROM facts WHERE board_id = ? AND status IN (${marks(status.length)})`;
  if (opts?.kinds?.length) {
    sql += ` AND kind IN (${marks(opts.kinds.length)})`;
    params.push(...opts.kinds);
  }
  sql += ` ORDER BY id`;
  return (await all<FactDbRow>(sql, params)).map(toFact);
}

/** All metric facts (any status) for history and trends. */
export async function metricHistory(boardId: string): Promise<Fact<"metric">[]> {
  const rows = await all<FactDbRow>(
    `SELECT * FROM facts WHERE board_id = ? AND kind = 'metric' AND verified = 1 AND status IN ('active', 'superseded') ORDER BY id`,
    [boardId],
  );
  return rows.map(toFact) as Fact<"metric">[];
}

const CHUNK = 100;

type InsertRow = Pick<NewFactRow, "kind" | "key" | "valueNum" | "asOf" | "sourceIds" | "quote"> & {
  payload: unknown;
  verified: 0 | 1;
  status: FactStatus;
};

/** Multi-row insert. The board lock keeps other writers away, so the rows this insert created are the newest ids. */
async function insertRows(
  db: Exec,
  boardId: string,
  runId: number | null,
  rows: InsertRow[],
  now: number,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: Param[] = [];
    for (const r of chunk) {
      params.push(
        boardId,
        r.kind,
        fkeyOf(r.kind, r.key),
        JSON.stringify(r.payload),
        r.valueNum ?? null,
        r.asOf ? r.asOf.slice(0, 40) : null,
        JSON.stringify(r.sourceIds),
        r.quote,
        r.verified,
        r.status,
        runId,
        now,
      );
    }
    const res = await db.run(
      `INSERT INTO facts (board_id, kind, fkey, payload, value_num, as_of, source_ids, quote, verified, status, run_id, created_at)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      params,
    );
    const got = await db.all<{ id: number }>(`SELECT id FROM facts WHERE board_id = ? AND id >= ? ORDER BY id LIMIT ?`, [
      boardId,
      Number(res.insertId),
      chunk.length,
    ]);
    if (got.length !== chunk.length) throw new Error(`facts insert returned ${got.length} ids for ${chunk.length} rows`);
    ids.push(...got.map((g) => Number(g.id)));
  }
  return ids;
}

/** Persists one merge in a transaction. Returns the inserted facts. */
export async function applyMerge(boardId: string, runId: number | null, merge: MergeResult): Promise<Fact[]> {
  return tx(async (db) => {
    const now = Date.now();
    const rows = merge.insert.map((r) => ({ ...r, verified: 1 as const, status: (r.status ?? "active") as FactStatus }));
    const insertRowsIn: InsertRow[] = rows;
    const ids = await insertRows(db, boardId, runId, insertRowsIn, now);
    const resolve = (ref: { id: number } | { index: number }) => ("id" in ref ? ref.id : ids[ref.index]);

    const supersededBy = new Map<number, number>();
    rows.forEach((r, i) => {
      if (r.status === "superseded" && r.supersededBy) {
        const target = resolve(r.supersededBy);
        if (target !== undefined) supersededBy.set(ids[i], target);
      }
    });
    for (const [id, by] of supersededBy) {
      await db.run(`UPDATE facts SET superseded_by = ? WHERE id = ? AND board_id = ?`, [by, id, boardId]);
    }
    for (const s of merge.supersede) {
      const by = ids[s.by];
      await db.run(`UPDATE facts SET status = 'superseded', superseded_by = ? WHERE id = ? AND board_id = ? AND status = 'active'`, [
        by ?? null,
        s.id,
        boardId,
      ]);
    }
    for (const a of merge.addSources) {
      const cur = await db.one<{ source_ids: string; as_of: string | null }>(
        `SELECT source_ids, as_of FROM facts WHERE id = ? AND board_id = ? FOR UPDATE`,
        [a.id, boardId],
      );
      if (!cur) continue;
      const merged = [...new Set([...(json<string[]>(cur.source_ids) ?? []), ...a.sourceIds])];
      const newer =
        a.asOf !== undefined && a.asOf !== null && (cur.as_of === null || (Date.parse(a.asOf) || 0) > (Date.parse(cur.as_of) || 0));
      await db.run(`UPDATE facts SET source_ids = ?, as_of = ? WHERE id = ? AND board_id = ?`, [
        JSON.stringify(merged),
        newer ? a.asOf!.slice(0, 40) : cur.as_of,
        a.id,
        boardId,
      ]);
    }

    return rows.map(
      (r, i): Fact => ({
        id: ids[i],
        boardId,
        kind: r.kind,
        key: fkeyOf(r.kind, r.key).slice(r.kind.length + 1),
        payload: r.payload,
        valueNum: r.valueNum ?? null,
        asOf: r.asOf ? r.asOf.slice(0, 40) : null,
        sourceIds: [...r.sourceIds],
        quote: r.quote,
        verified: true,
        status: r.status,
        supersededBy: supersededBy.get(ids[i]) ?? null,
        runId,
        createdAt: now,
      }),
    );
  });
}

/** Rejected facts are kept (status rejected, verified 0) so evals can see why. The reason goes in payload._rejected. */
export async function saveRejected(boardId: string, runId: number | null, rejected: { fact: ExtractedFact; reason: string }[]): Promise<void> {
  if (!rejected.length) return;
  await tx(async (db) => {
    const rows = rejected.map(({ fact, reason }) => {
      const p = (fact.payload ?? {}) as unknown as Record<string, unknown>;
      const vn = fact.kind === "metric" && typeof p.valueNum === "number" && Number.isFinite(p.valueNum) ? (p.valueNum as number) : null;
      return {
        kind: fact.kind,
        key: String(fact.key ?? "unknown"),
        payload: { ...p, _rejected: reason } as unknown,
        valueNum: vn,
        asOf: typeof fact.asOf === "string" ? fact.asOf : null,
        sourceIds: fact.sourceId ? [String(fact.sourceId)] : [],
        quote: typeof fact.quote === "string" ? fact.quote.slice(0, 2000) : null,
        verified: 0 as const,
        status: "rejected" as FactStatus,
      } satisfies InsertRow;
    });
    await insertRows(db, boardId, runId, rows, Date.now());
  });
}

export async function updatePlaceCoords(factId: number, lat: number, lon: number): Promise<void> {
  await run(`UPDATE facts SET payload = JSON_SET(payload, '$.lat', ?, '$.lon', ?) WHERE id = ? AND kind = 'place'`, [lat, lon, factId]);
}

/** Stores English translations of quotes. Only fills a fact that has none, so a retried step cannot overwrite one. */
export async function setQuoteTranslations(boardId: string, rows: { id: number; quoteEn: string }[]): Promise<void> {
  if (!rows.length) return;
  await tx(async (db) => {
    for (const r of rows) {
      await db.run(`UPDATE facts SET quote_en = ? WHERE id = ? AND board_id = ? AND quote_en IS NULL`, [r.quoteEn.slice(0, 1000), r.id, boardId]);
    }
  });
}
