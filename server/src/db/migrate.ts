import type { Pool } from "mariadb";
import { migrations } from "./migrations";

export type Migration = { id: number; name: string; up: string[] };

export async function migrate(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL, applied_at BIGINT NOT NULL)`,
  );
  const done = new Set(
    Array.from((await pool.query(`SELECT id FROM schema_migrations`)) as { id: number }[]).map((r) => r.id),
  );
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    // MariaDB commits DDL implicitly, so a migration is not atomic. Keep each statement idempotent.
    for (const sql of m.up) await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`, [m.id, m.name, Date.now()]);
    console.log(`[faraday] migration ${m.id} ${m.name} applied`);
  }
}
