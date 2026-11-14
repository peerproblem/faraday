import type { Pool } from "mariadb";
import { createPool, migrate } from "./schema";

declare global {
  var __faradayDb: Promise<Pool> | undefined;
}

async function open(): Promise<Pool> {
  const pool = createPool();
  await migrate(pool);
  return pool;
}

function pool(): Promise<Pool> {
  globalThis.__faradayDb ??= open().catch((e) => {
    globalThis.__faradayDb = undefined;
    throw e;
  });
  return globalThis.__faradayDb;
}

type Param = string | number | null;

export async function all<T>(sql: string, params: Param[] = []): Promise<T[]> {
  const rows = (await (await pool()).query(sql, params)) as T[];
  return Array.from(rows);
}

export async function one<T>(sql: string, params: Param[] = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: Param[] = []): Promise<{ insertId: number; affectedRows: number }> {
  return (await (await pool()).query(sql, params)) as { insertId: number; affectedRows: number };
}

export function json<T>(value: unknown): T | null {
  if (typeof value !== "string" || value === "") return null;
  return JSON.parse(value) as T;
}
