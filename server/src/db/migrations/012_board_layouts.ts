import type { Migration } from "./steps";

export const m012: Migration = {
  id: 12,
  name: "board_layouts",
  up: [
    `CREATE TABLE IF NOT EXISTS board_layout_templates (
      id VARCHAR(32) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      settings JSON NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS board_layouts (
      board_id VARCHAR(32) PRIMARY KEY,
      template_id VARCHAR(32) NULL,
      settings JSON NOT NULL
    )`,
  ],
};
