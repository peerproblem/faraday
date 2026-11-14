import { migrations } from "./migrations";
import { runStep, type Queryable } from "./migrations/steps";

export { addColumn, addIndex, runStep, type Migration, type Queryable, type Step } from "./migrations/steps";

export async function migrate(db: Queryable) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL, applied_at BIGINT NOT NULL)`,
  );
  const done = new Set(
    Array.from((await db.query(`SELECT id FROM schema_migrations`)) as { id: number }[]).map((r) => Number(r.id)),
  );
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    // MySQL and MariaDB both commit DDL implicitly, so a migration is not atomic. Keep each step idempotent
    // (CREATE TABLE IF NOT EXISTS, addColumn, addIndex, UPDATEs that only touch rows still to be filled).
    for (const step of m.up) await runStep(db, step);
    await db.query(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`, [m.id, m.name, Date.now()]);
    console.log(`[faraday] migration ${m.id} ${m.name} applied`);
  }
}
