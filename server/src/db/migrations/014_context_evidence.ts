import type { Migration } from "./steps";

export const m014: Migration = {
  id: 14,
  name: "context evidence",
  up: [
    `CREATE TABLE IF NOT EXISTS context_evidence (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      board_id VARCHAR(32) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      result_key CHAR(64) NOT NULL,
      payload LONGTEXT NOT NULL,
      collected_at BIGINT NOT NULL,
      UNIQUE KEY context_evidence_result (board_id, kind, result_key),
      INDEX context_evidence_board (board_id, kind, id),
      CONSTRAINT context_evidence_board_fk FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    )`,
    `INSERT INTO context_evidence (board_id, kind, result_key, payload, collected_at)
     SELECT board_id, kind, SHA2(TRIM(SUBSTRING_INDEX(url, '#', 1)), 256),
       JSON_OBJECT('url', url, 'title', COALESCE(title_en, title, url), 'publisher', publisher, 'publishedAt', published_at), fetched_at
     FROM sources WHERE via = 'contextdev' AND kind IN ('news', 'web')
     ORDER BY fetched_at, id
     ON DUPLICATE KEY UPDATE result_key = VALUES(result_key)`,
    `INSERT INTO context_evidence (board_id, kind, result_key, payload, collected_at)
     SELECT board_id, 'monitor', SHA2(CONCAT('event:', id), 256),
       JSON_OBJECT('url', JSON_VALUE(data, '$.url'), 'title', JSON_VALUE(data, '$.title'),
         'summary', JSON_VALUE(data, '$.summary'), 'importance', JSON_VALUE(data, '$.importance')), ts
     FROM events WHERE kind = 'change' AND message LIKE 'Monitor:%' AND JSON_VALID(data) AND JSON_VALUE(data, '$.url') IS NOT NULL
     ORDER BY ts, id
     ON DUPLICATE KEY UPDATE result_key = VALUES(result_key)`,
  ],
};
