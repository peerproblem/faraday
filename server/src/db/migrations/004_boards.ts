import { addColumn, addIndex, type Migration } from "./steps";

// Board v2 columns, list columns, scheduling, visibility and soft delete; monitor targets (guide P1-4, P3-1, P4-2, P4-3).
export const m004: Migration = {
  id: 4,
  name: "boards_v2",
  up: [
    addColumn("boards", "spec_version", "INT NOT NULL DEFAULT 1"),
    addColumn("boards", "data", "LONGTEXT NULL"),
    addColumn("boards", "language", "VARCHAR(16) NULL"),
    addColumn("boards", "crisis_type", "VARCHAR(32) NULL"),
    addColumn("boards", "severity", "DOUBLE NULL"),
    addColumn("boards", "headline", "TEXT NULL"),
    addColumn("boards", "accent", "VARCHAR(16) NULL"),
    addColumn("boards", "situation", "VARCHAR(16) NULL"),
    addColumn("boards", "running_job_id", "BIGINT NULL"),
    addColumn("boards", "tier", "VARCHAR(8) NOT NULL DEFAULT 'hot'"),
    addColumn("boards", "next_poll_at", "BIGINT NULL"),
    addColumn("boards", "last_viewed_at", "BIGINT NULL"),
    addColumn("boards", "last_changed_at", "BIGINT NULL"),
    addColumn("boards", "visibility", "VARCHAR(8) NOT NULL DEFAULT 'public'"),
    addColumn("boards", "deleted_at", "BIGINT NULL"),
    addIndex("boards", "boards_due", ["tier", "next_poll_at"]),
    addIndex("boards", "boards_list", ["deleted_at", "visibility", "updated_at"]),
    // List columns for v1 boards, read from their v1 spec JSON.
    `UPDATE boards SET
       crisis_type = COALESCE(crisis_type, JSON_VALUE(spec, '$.crisisType')),
       severity = COALESCE(severity, CAST(JSON_VALUE(spec, '$.severity') AS DOUBLE)),
       headline = COALESCE(headline, JSON_VALUE(spec, '$.headline')),
       accent = COALESCE(accent, JSON_VALUE(spec, '$.accent')),
       situation = COALESCE(situation, JSON_VALUE(spec, '$.status'))
     WHERE spec IS NOT NULL AND spec_version = 1 AND JSON_VALID(spec)`,
    addColumn("monitors", "target", "TEXT NULL"),
    `UPDATE monitors SET target = query WHERE target IS NULL`,
  ],
};
