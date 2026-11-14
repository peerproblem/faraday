/** The one method the runner needs, so it works with any pool or connection of the driver. */
export type Queryable = { query(sql: string, params?: unknown[]): Promise<unknown> };

/**
 * A migration step: plain SQL, or a schema change that only runs when the column or index is missing.
 * MySQL has no ADD COLUMN IF NOT EXISTS or ADD INDEX IF NOT EXISTS (MariaDB does), so those go through
 * addColumn and addIndex, which check information_schema first and behave the same on both engines.
 */
export type Step =
  | string
  | { kind: "addColumn"; table: string; column: string; definition: string }
  | { kind: "addIndex"; table: string; name: string; columns: string[]; unique: boolean };

export type Migration = { id: number; name: string; up: Step[] };

/** ALTER TABLE table ADD COLUMN column definition, unless the column exists. */
export function addColumn(table: string, column: string, definition: string): Step {
  return { kind: "addColumn", table, column, definition };
}

/** ALTER TABLE table ADD [UNIQUE] INDEX name (columns), unless an index with that name exists. */
export function addIndex(table: string, name: string, columns: string[], opts: { unique?: boolean } = {}): Step {
  return { kind: "addIndex", table, name, columns, unique: !!opts.unique };
}

async function count(db: Queryable, sql: string, params: string[]): Promise<number> {
  const rows = Array.from((await db.query(sql, params)) as { n: number | bigint | string }[]);
  return Number(rows[0]?.n ?? 0);
}

export async function runStep(db: Queryable, step: Step) {
  if (typeof step === "string") {
    await db.query(step);
    return;
  }
  if (step.kind === "addColumn") {
    const has = await count(
      db,
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [step.table, step.column],
    );
    if (!has) await db.query(`ALTER TABLE \`${step.table}\` ADD COLUMN \`${step.column}\` ${step.definition}`);
    return;
  }
  const has = await count(
    db,
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [step.table, step.name],
  );
  if (!has) {
    const cols = step.columns.map((c) => `\`${c}\``).join(", ");
    await db.query(`ALTER TABLE \`${step.table}\` ADD ${step.unique ? "UNIQUE " : ""}INDEX \`${step.name}\` (${cols})`);
  }
}
