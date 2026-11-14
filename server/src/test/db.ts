import mariadb from "mariadb";
import { afterAll, beforeAll } from "vitest";
import { closePool, pool } from "../db/pool";

/**
 * Gives a test file its own empty, migrated database on the VPS (through the SSH tunnel on
 * 127.0.0.1:3307). `name` must be unique per test file, e.g. "repo_boards".
 * Skips the suite when TEST_DATABASE_URL is not set.
 */
export function useTestDb(name: string) {
  const base = process.env.TEST_DATABASE_URL;
  const dbName = `faraday_test_${name}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 60);
  const enabled = !!base;
  beforeAll(async () => {
    if (!base) return;
    const u = new URL(base);
    const admin = await mariadb.createConnection({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    });
    await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();
    u.pathname = `/${dbName}`;
    process.env.DATABASE_URL = u.toString();
    await closePool();
    await pool();
  }, 60_000);
  afterAll(async () => {
    await closePool();
  });
  return { enabled, dbName };
}
