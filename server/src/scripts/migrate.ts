// Applies pending migrations and exits: npm run migrate. Services run with FARADAY_SKIP_MIGRATE=1.
import { createPool } from "../db/pool";
import { migrate } from "../db/migrate";

const pool = createPool();
try {
  await migrate(pool);
  const rows = (await pool.query(`SELECT id, name FROM schema_migrations ORDER BY id`)) as { id: number; name: string }[];
  console.log(`[faraday] schema at ${rows.at(-1)?.id ?? 0} (${rows.map((r) => r.name).join(", ")})`);
} catch (e) {
  console.error("[faraday] migration failed", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
