import type { Migration } from "../migrate";

// Board v2 columns, list columns, scheduling, visibility and soft delete; monitor targets (guide P1-4, P3-1, P4-2, P4-3).
export const m004: Migration = {
  id: 4,
  name: "boards_v2",
  up: [
    `ALTER TABLE boards
      ADD COLUMN IF NOT EXISTS spec_version INT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS data LONGTEXT NULL,
      ADD COLUMN IF NOT EXISTS language VARCHAR(16) NULL,
      ADD COLUMN IF NOT EXISTS crisis_type VARCHAR(32) NULL,
      ADD COLUMN IF NOT EXISTS severity DOUBLE NULL,
      ADD COLUMN IF NOT EXISTS headline TEXT NULL,
      ADD COLUMN IF NOT EXISTS accent VARCHAR(16) NULL,
      ADD COLUMN IF NOT EXISTS situation VARCHAR(16) NULL,
      ADD COLUMN IF NOT EXISTS running_job_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS tier VARCHAR(8) NOT NULL DEFAULT 'hot',
      ADD COLUMN IF NOT EXISTS next_poll_at BIGINT NULL,
      ADD COLUMN IF NOT EXISTS last_viewed_at BIGINT NULL,
      ADD COLUMN IF NOT EXISTS last_changed_at BIGINT NULL,
      ADD COLUMN IF NOT EXISTS visibility VARCHAR(8) NOT NULL DEFAULT 'public',
      ADD COLUMN IF NOT EXISTS deleted_at BIGINT NULL`,
    `ALTER TABLE boards ADD INDEX IF NOT EXISTS boards_due (tier, next_poll_at)`,
    `ALTER TABLE boards ADD INDEX IF NOT EXISTS boards_list (deleted_at, visibility, updated_at)`,
    // List columns for v1 boards, read from their v1 spec JSON.
    `UPDATE boards SET
       crisis_type = COALESCE(crisis_type, JSON_VALUE(spec, '$.crisisType')),
       severity = COALESCE(severity, CAST(JSON_VALUE(spec, '$.severity') AS DOUBLE)),
       headline = COALESCE(headline, JSON_VALUE(spec, '$.headline')),
       accent = COALESCE(accent, JSON_VALUE(spec, '$.accent')),
       situation = COALESCE(situation, JSON_VALUE(spec, '$.status'))
     WHERE spec IS NOT NULL AND spec_version = 1 AND JSON_VALID(spec)`,
    `ALTER TABLE monitors ADD COLUMN IF NOT EXISTS target TEXT NULL`,
    `UPDATE monitors SET target = query WHERE target IS NULL`,
  ],
};
