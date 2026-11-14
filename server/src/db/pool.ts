import mariadb, { type Pool, type PoolConnection } from "mariadb";
import { migrate } from "./migrate";

declare global {
  var __faradayDb: Promise<Pool> | undefined;
}

export type Param = string | number | null | boolean;
export type Exec = {
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  one<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ insertId: number; affectedRows: number }>;
};

export function createPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set (mariadb://user:password@host:3306/database)");
  const u = new URL(databaseUrl);
  return mariadb.createPool({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: Number(u.searchParams.get("connectionLimit") ?? 10),
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    decimalAsNumber: true,
    timezone: "Z",
  });
}

async function open(): Promise<Pool> {
  const pool = createPool();
  if (process.env.FARADAY_SKIP_MIGRATE !== "1") await migrate(pool);
  return pool;
}

export function pool(): Promise<Pool> {
  globalThis.__faradayDb ??= open().catch((e) => {
    globalThis.__faradayDb = undefined;
    throw e;
  });
  return globalThis.__faradayDb;
}

export async function closePool() {
  const p = globalThis.__faradayDb;
  globalThis.__faradayDb = undefined;
  if (p) await (await p).end().catch(() => {});
}

function exec(q: Pool | PoolConnection): Exec {
  return {
    async all<T>(sql: string, params: Param[] = []) {
      return Array.from((await q.query(sql, params)) as T[]);
    },
    async one<T>(sql: string, params: Param[] = []) {
      return Array.from((await q.query(sql, params)) as T[])[0];
    },
    async run(sql: string, params: Param[] = []) {
      return (await q.query(sql, params)) as { insertId: number; affectedRows: number };
    },
  };
}

export const all = async <T>(sql: string, params: Param[] = []) => exec(await pool()).all<T>(sql, params);
export const one = async <T>(sql: string, params: Param[] = []) => exec(await pool()).one<T>(sql, params);
export const run = async (sql: string, params: Param[] = []) => exec(await pool()).run(sql, params);

/** Runs fn in one transaction. Rolls back if it throws. */
export async function tx<T>(fn: (db: Exec) => Promise<T>): Promise<T> {
  const conn = await (await pool()).getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(exec(conn));
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

export function json<T>(value: unknown): T | null {
  if (typeof value !== "string" || value === "") return null;
  return JSON.parse(value) as T;
}
