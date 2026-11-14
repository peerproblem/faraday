import mariadb, { type Pool } from "mariadb";

// Schema and pool setup for MariaDB.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    name VARCHAR(255),
    image TEXT,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS boards (
    id VARCHAR(32) PRIMARY KEY,
    slug VARCHAR(63) NOT NULL UNIQUE,
    owner_id CHAR(36),
    prompt TEXT NOT NULL,
    title VARCHAR(500),
    status VARCHAR(16) NOT NULL,
    plan LONGTEXT,
    spec LONGTEXT,
    version INT NOT NULL DEFAULT 0,
    metrics LONGTEXT,
    last_polled_at BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    INDEX boards_updated (updated_at),
    INDEX boards_owner (owner_id, updated_at),
    INDEX boards_status (status)
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    board_id VARCHAR(32) NOT NULL,
    id VARCHAR(16) NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    publisher VARCHAR(255),
    kind VARCHAR(16),
    published_at VARCHAR(64),
    fetched_at BIGINT NOT NULL,
    snippet TEXT,
    discarded TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (board_id, id),
    CONSTRAINT sources_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    board_id VARCHAR(32) NOT NULL,
    ts BIGINT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    message TEXT NOT NULL,
    data LONGTEXT,
    INDEX events_board (board_id, id),
    CONSTRAINT events_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS monitors (
    id VARCHAR(64) PRIMARY KEY,
    board_id VARCHAR(32) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    query TEXT,
    last_seen_change_at VARCHAR(64),
    webhook_secret VARCHAR(255),
    created_at BIGINT NOT NULL,
    INDEX monitors_board (board_id),
    CONSTRAINT monitors_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    board_id VARCHAR(32) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    ts BIGINT NOT NULL,
    INDEX messages_board (board_id, id),
    CONSTRAINT messages_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  )`,
];

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

export async function migrate(pool: Pool) {
  for (const sql of SCHEMA) await pool.query(sql);
}
