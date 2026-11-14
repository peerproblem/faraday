import type { Migration } from "../migrate";

// Runtime settings an admin changes from /admin. discover_enabled starts off: only topics an admin registers show up.
export const m008: Migration = {
  id: 8,
  name: "app_settings",
  up: [
    `CREATE TABLE IF NOT EXISTS app_settings (
      name VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    `INSERT IGNORE INTO app_settings (name, value, updated_at) VALUES ('discover_enabled', '0', UNIX_TIMESTAMP() * 1000)`,
  ],
};
