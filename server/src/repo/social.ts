import { tx, run, one, type Exec } from "../db/pool";

export function dailyLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** Fixed lock order (global, board), shared by all workers. Reserve the maximum billable reads.
 * No refunds: timeouts/errors/crashes may still have incurred a charge at X. UTC daily reset. */
export async function reserveReadsIn(db: Exec, boardId: string, count: number, now: number,
  boardLimit: number, globalLimit: number): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  for (const [scope, limit] of [["global", globalLimit], [`board:${boardId}`, boardLimit]] as const) {
    // The upsert takes the row's exclusive lock at once. INSERT IGNORE takes a shared one, and two workers
    // that both hold it deadlock on the SELECT ... FOR UPDATE below.
    await db.run(`INSERT INTO social_daily_reads (day, scope, read_count) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE read_count = read_count`, [day, scope]);
    const row = await db.one<{ read_count: number }>(`SELECT read_count FROM social_daily_reads WHERE day = ? AND scope = ? FOR UPDATE`, [day, scope]);
    if (Number(row?.read_count ?? 0) + count > limit) return false;
  }
  await db.run(`UPDATE social_daily_reads SET read_count = read_count + ? WHERE day = ? AND scope IN (?, ?)`, [count, day, "global", `board:${boardId}`]);
  return true;
}

export async function reserveSocialReads(boardId: string, queryKey: string, count: number, now = Date.now()) {
  return tx(async (db) => {
    const allowed = await reserveReadsIn(db, boardId, count, now,
      dailyLimit(process.env.X_BOARD_DAILY_READ_LIMIT, 20), dailyLimit(process.env.X_GLOBAL_DAILY_READ_LIMIT, 100));
    if (!allowed) return null;
    const cursor = await db.one<{ since_id: string }>(`SELECT since_id FROM social_cursors WHERE board_id = ? AND query_key = ?`, [boardId, queryKey]);
    return { sinceId: cursor?.since_id };
  });
}

export async function advanceSocialCursor(boardId: string, queryKey: string, sinceId: string) {
  if (!/^\d{1,19}$/.test(sinceId)) throw new Error("Invalid X cursor");
  await run(`INSERT INTO social_cursors (board_id, query_key, since_id) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE since_id = IF(CAST(VALUES(since_id) AS UNSIGNED) > CAST(since_id AS UNSIGNED), VALUES(since_id), since_id)`,
    [boardId, queryKey, sinceId]);
}

/** Replay uses the same stored cursor as a live run, without reserving billable reads. */
export async function getSocialCursor(boardId: string, queryKey: string): Promise<{ sinceId?: string }> {
  const row = await one<{ since_id: string }>(`SELECT since_id FROM social_cursors WHERE board_id = ? AND query_key = ?`, [boardId, queryKey]);
  return { sinceId: row?.since_id };
}
