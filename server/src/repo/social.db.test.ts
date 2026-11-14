import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all, run } from "../db/pool";
import { useTestDb } from "../test/db";
import { advanceSocialCursor, reserveSocialReads } from "./social";

const { enabled } = useTestDb("social");
describe.skipIf(!enabled)("durable social guards", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => { vi.stubEnv("X_BOARD_DAILY_READ_LIMIT", "20"); vi.stubEnv("X_GLOBAL_DAILY_READ_LIMIT", "100"); await run("DELETE FROM social_daily_reads"); await run("DELETE FROM social_cursors"); });
  it("enforces both limits across concurrent workers, including UTC day rollover", async () => {
    // Defaults: board 20, global 100. One request reserves 10 reads.
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveSocialReads("b", "q", 10, 0)));
    expect(results.filter(Boolean)).toHaveLength(2);
    const other = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveSocialReads(`other${i}`, "q", 10, 0)));
    expect(other.filter(Boolean)).toHaveLength(8);
    expect(await reserveSocialReads("b", "q", 10, 86_400_000)).not.toBeNull();
  });
  it("keeps exact snowflake cursors per board/query and never rewinds", async () => {
    await advanceSocialCursor("b", "q1", "1900000000000000002");
    await advanceSocialCursor("b", "q1", "1900000000000000001");
    await advanceSocialCursor("b", "q2", "1900000000000000003");
    const rows = await all<{ query_key: string; since_id: string }>("SELECT query_key, since_id FROM social_cursors ORDER BY query_key");
    expect(rows.map((r) => r.since_id)).toEqual(["1900000000000000002", "1900000000000000003"]);
  });
});
