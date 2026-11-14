import type { Migration } from "../migrate";

// Shared topics (system-owned boards found by the discover job) and personal views (a per-user layout overlay on a
// topic's baseline board), plus discovery candidates and data requests users leave on a topic.
export const m007: Migration = {
  id: 7,
  name: "topics_and_views",
  up: [
    // origin: 'system' (a shared topic) or 'user' (a board made from a prompt before that feature was removed).
    // topic_state (system only): 'active' | 'archived' | 'merged'. entities: JSON string[] copied from plan.entities.
    `ALTER TABLE boards
      ADD COLUMN IF NOT EXISTS origin VARCHAR(8) NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS topic_state VARCHAR(16) NULL,
      ADD COLUMN IF NOT EXISTS entities TEXT NULL,
      ADD COLUMN IF NOT EXISTS location_name VARCHAR(255) NULL,
      ADD COLUMN IF NOT EXISTS rank_score DOUBLE NULL,
      ADD COLUMN IF NOT EXISTS merged_into VARCHAR(32) NULL,
      ADD COLUMN IF NOT EXISTS discovered_at BIGINT NULL`,
    `ALTER TABLE boards ADD INDEX IF NOT EXISTS boards_topics (origin, deleted_at, topic_state, rank_score)`,
    // Boards can no longer be made from prompts, so the public boards that exist become shared topics.
    `UPDATE boards SET origin = 'system', topic_state = 'active'
     WHERE deleted_at IS NULL AND visibility = 'public' AND origin = 'user'`,
    `UPDATE boards SET
       entities = COALESCE(entities, JSON_EXTRACT(plan, '$.entities')),
       location_name = COALESCE(location_name, JSON_VALUE(plan, '$.location.name'))
     WHERE plan IS NOT NULL AND JSON_VALID(plan) AND spec_version = 2`,
    `CREATE TABLE IF NOT EXISTS topic_candidates (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      run_id BIGINT NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      title VARCHAR(500) NOT NULL,
      crisis_type VARCHAR(32) NOT NULL,
      location_name VARCHAR(255) NULL,
      entities TEXT NOT NULL,
      score DOUBLE NOT NULL,
      decision VARCHAR(16) NOT NULL,
      board_id VARCHAR(32) NULL,
      reason TEXT NULL,
      evidence LONGTEXT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX topic_candidates_fp (fingerprint, created_at),
      INDEX topic_candidates_created (created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS personal_views (
      user_id CHAR(36) NOT NULL,
      board_id VARCHAR(32) NOT NULL,
      layout LONGTEXT NOT NULL,
      rev INT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, board_id),
      INDEX personal_views_user (user_id, updated_at),
      CONSTRAINT personal_views_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      CONSTRAINT personal_views_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    // Last 20 revisions per view, for undo.
    `CREATE TABLE IF NOT EXISTS personal_view_revisions (
      user_id CHAR(36) NOT NULL,
      board_id VARCHAR(32) NOT NULL,
      rev INT NOT NULL,
      layout LONGTEXT NOT NULL,
      instruction TEXT NULL,
      reply TEXT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, board_id, rev)
    )`,
    `CREATE TABLE IF NOT EXISTS topic_requests (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      board_id VARCHAR(32) NOT NULL,
      user_id CHAR(36) NOT NULL,
      text TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      created_at BIGINT NOT NULL,
      INDEX topic_requests_board (board_id, status),
      CONSTRAINT topic_requests_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    )`,
  ],
};
