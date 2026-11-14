import type { Migration } from "../migrate";

// Content versions for sources, monitor change checkpoints, monitor sync state and the webhook inbox.
export const m005: Migration = {
  id: 5,
  name: "monitor_sync",
  up: [
    // content_hash: hash of the raw text a monitor reported for this URL; refreshed_at: when that text last changed.
    `ALTER TABLE sources
      ADD COLUMN IF NOT EXISTS content_hash CHAR(64) NULL,
      ADD COLUMN IF NOT EXISTS refreshed_at BIGINT NULL`,
    // config_hash: what the monitor was last created or updated with (target, instructions, webhook, schedule).
    // remote_status/last_error/checked_at: the last health check. 'dead' rows were removed at Context.dev after
    // failing and stay only so the same URL is not watched again.
    `ALTER TABLE monitors
      ADD COLUMN IF NOT EXISTS config_hash CHAR(64) NULL,
      ADD COLUMN IF NOT EXISTS schedule_minutes INT NULL,
      ADD COLUMN IF NOT EXISTS remote_status VARCHAR(16) NULL,
      ADD COLUMN IF NOT EXISTS last_error TEXT NULL,
      ADD COLUMN IF NOT EXISTS checked_at BIGINT NULL`,
    `ALTER TABLE boards ADD COLUMN IF NOT EXISTS monitors_synced_at BIGINT NULL`,
    // Changes already turned into sources. The checkpoint (monitors.last_seen_change_at) is inclusive, so the
    // boundary change comes back on the next read and is skipped here.
    `CREATE TABLE IF NOT EXISTS monitor_changes (
      change_id VARCHAR(64) PRIMARY KEY,
      monitor_id VARCHAR(64) NOT NULL,
      detected_at VARCHAR(64) NOT NULL,
      seen_at BIGINT NOT NULL,
      INDEX monitor_changes_monitor (monitor_id, detected_at)
    )`,
    // Verified webhook events by their stable id (body id = X-Context-Id), so retries and replays queue once.
    `CREATE TABLE IF NOT EXISTS webhook_events (
      event_id VARCHAR(64) PRIMARY KEY,
      monitor_id VARCHAR(64) NULL,
      event VARCHAR(32) NOT NULL,
      received_at BIGINT NOT NULL,
      INDEX webhook_events_received (received_at)
    )`,
  ],
};
