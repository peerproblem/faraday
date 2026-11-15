import type { Migration } from "./steps";

// Outbound distribution (GTM): Discord channels that follow topics, and one row per post sent to X or Discord.
// A post row is written before the send, so a second worker or a retry never posts the same update twice.
export const m011: Migration = {
  id: 11,
  name: "distribution",
  up: [
    `CREATE TABLE IF NOT EXISTS discord_follows (
      channel_id VARCHAR(32) NOT NULL,
      board_id VARCHAR(32) NOT NULL,
      guild_id VARCHAR(32) NULL,
      created_by VARCHAR(32) NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (channel_id, board_id),
      KEY discord_follows_board (board_id)
    )`,
    `CREATE TABLE IF NOT EXISTS outbound_posts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      channel VARCHAR(16) NOT NULL,
      target VARCHAR(32) NOT NULL,
      board_id VARCHAR(32) NOT NULL,
      event_key VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL,
      external_id VARCHAR(64) NULL,
      error VARCHAR(500) NULL,
      created_at BIGINT NOT NULL,
      UNIQUE KEY outbound_posts_once (channel, target, board_id, event_key),
      KEY outbound_posts_recent (channel, target, board_id, created_at)
    )`,
  ],
};
