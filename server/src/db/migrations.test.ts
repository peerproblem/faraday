import mariadb from "mariadb";
import { afterAll, describe, expect, it } from "vitest";
import { connectionConfig } from "./connect";
import { createPool } from "./pool";
import { migrate, runStep } from "./migrate";
import { m001 } from "./migrations/001_baseline";
import { migrations } from "./migrations";
import { useTestDb } from "../test/db";
import { all } from "./pool";

const { enabled } = useTestDb("migrations");
const base = process.env.TEST_DATABASE_URL;
const prodLike = "faraday_test_migrations_prod";

async function admin() {
  return mariadb.createConnection(connectionConfig(base!, { database: null }));
}

const v1Spec = {
  title: "Kyiv blackouts",
  crisisType: "outage",
  status: "ongoing",
  severity: 4,
  headline: "Most of Kyiv is without power.",
  accent: "violet",
  layout: [],
};

describe.skipIf(!enabled)("migrations", () => {
  afterAll(async () => {
    const c = await admin();
    await c.query(`DROP DATABASE IF EXISTS \`${prodLike}\``);
    await c.end();
  });

  it("applies every migration on an empty database", async () => {
    const applied = await all<{ id: number }>(`SELECT id FROM schema_migrations ORDER BY id`);
    expect(applied.map((r) => Number(r.id))).toEqual(migrations.map((m) => m.id));
    const tables = (await all<{ t: string }>(`SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`)).map(
      (r) => r.t,
    );
    for (const t of ["jobs", "runs", "run_steps", "facts", "source_texts", "board_versions", "geocode_cache", "worker_heartbeats"]) {
      expect(tables).toContain(t);
    }
  });

  it("upgrades a production-shaped database with v1 data", async () => {
    const c = await admin();
    await c.query(`DROP DATABASE IF EXISTS \`${prodLike}\``);
    await c.query(`CREATE DATABASE \`${prodLike}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.query(`USE \`${prodLike}\``);
    for (const step of m001.up) await runStep(c, step);
    const now = Date.now();
    await c.query(
      `INSERT INTO boards (id, slug, owner_id, prompt, title, status, plan, spec, version, metrics, last_polled_at, created_at, updated_at)
       VALUES ('b1', 'kyiv-abc', NULL, 'Kyiv blackouts', 'Kyiv blackouts', 'live', '{}', ?, 3, NULL, ?, ?, ?)`,
      [JSON.stringify(v1Spec), now, now, now],
    );
    await c.query(
      `INSERT INTO sources (board_id, id, url, title, publisher, kind, published_at, fetched_at, snippet)
       VALUES ('b1', 's1', 'https://a.example/x', 't', 'a', 'news', NULL, ?, 'x'),
              ('b1', 's2', 'https://b.example/y', 't', 'b', 'web', NULL, ?, 'y')`,
      [now, now],
    );
    await c.query(`INSERT INTO monitors (id, board_id, kind, query, created_at) VALUES ('m1', 'b1', 'search', 'kyiv power', ?)`, [now]);
    await c.end();

    const u = new URL(base!);
    u.pathname = `/${prodLike}`;
    const p = createPool(u.toString());
    try {
      // Mark 001 as applied, as it is in production after the first deploy of the migration runner.
      await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL, applied_at BIGINT NOT NULL)`);
      await p.query(`INSERT INTO schema_migrations VALUES (1, 'baseline', ?)`, [now]);
      await migrate(p);
      await migrate(p); // second run is a no-op
      const [b] = (await p.query(`SELECT spec_version, tier, visibility, crisis_type, severity, headline, accent, situation FROM boards`)) as Record<
        string,
        unknown
      >[];
      expect(b).toMatchObject({
        spec_version: 1,
        tier: "hot",
        visibility: "public",
        crisis_type: "outage",
        severity: 4,
        headline: "Most of Kyiv is without power.",
        accent: "violet",
        situation: "ongoing",
      });
      const sources = (await p.query(`SELECT id, url_hash FROM sources ORDER BY id`)) as { id: string; url_hash: string }[];
      expect(sources.every((s) => /^[0-9a-f]{64}$/.test(s.url_hash))).toBe(true);
      const [m] = (await p.query(`SELECT target FROM monitors`)) as { target: string }[];
      expect(m.target).toBe("kyiv power");
    } finally {
      await p.end();
    }
  });

  it("also upgrades a database where 001 was created without the migration table", async () => {
    // Statements in 001 are CREATE IF NOT EXISTS, so running every migration over the existing tables is safe.
    const u = new URL(base!);
    u.pathname = `/${prodLike}`;
    const p = createPool(u.toString());
    try {
      await p.query(`DELETE FROM schema_migrations`);
      await migrate(p);
      const rows = (await p.query(`SELECT id FROM schema_migrations ORDER BY id`)) as { id: number }[];
      expect(rows.map((r) => Number(r.id))).toEqual(migrations.map((m) => m.id));
    } finally {
      await p.end();
    }
  });
});
