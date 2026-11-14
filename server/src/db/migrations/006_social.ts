import type { Migration } from "../migrate";

export const m006: Migration = {
  id: 6,
  name: "social_read_guards",
  up: [
    `ALTER TABLE sources MODIFY COLUMN snippet LONGTEXT NULL`,
    `CREATE TABLE IF NOT EXISTS social_daily_reads (
      day CHAR(10) NOT NULL, scope VARCHAR(64) NOT NULL, read_count INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (day, scope)
    )`,
    `CREATE TABLE IF NOT EXISTS social_cursors (
      board_id VARCHAR(64) NOT NULL, query_key CHAR(64) NOT NULL, since_id VARCHAR(19) NOT NULL,
      PRIMARY KEY (board_id, query_key)
    )`,
  ],
};
