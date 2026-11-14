import { addColumn, addIndex, type Migration } from "./steps";

// Fact store, source texts, board versions, geocode cache, source triage columns (guide P3-1, P3-8).
export const m003: Migration = {
  id: 3,
  name: "facts",
  up: [
    `CREATE TABLE IF NOT EXISTS facts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      board_id VARCHAR(32) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      fkey VARCHAR(191) NOT NULL,
      payload LONGTEXT NOT NULL,
      value_num DOUBLE NULL,
      as_of VARCHAR(40) NULL,
      source_ids TEXT NOT NULL,
      quote TEXT NULL,
      verified TINYINT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      superseded_by BIGINT NULL,
      run_id BIGINT NULL,
      created_at BIGINT NOT NULL,
      INDEX facts_board (board_id, status, kind),
      INDEX facts_key (board_id, fkey, as_of),
      CONSTRAINT facts_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS source_texts (
      board_id VARCHAR(32) NOT NULL,
      source_id VARCHAR(16) NOT NULL,
      markdown MEDIUMTEXT NOT NULL,
      fetched_at BIGINT NOT NULL,
      PRIMARY KEY (board_id, source_id),
      CONSTRAINT source_texts_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS board_versions (
      board_id VARCHAR(32) NOT NULL,
      version INT NOT NULL,
      spec LONGTEXT NOT NULL,
      data LONGTEXT NOT NULL,
      change_note TEXT,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (board_id, version),
      CONSTRAINT board_versions_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS geocode_cache (
      query_hash CHAR(64) PRIMARY KEY,
      query TEXT NOT NULL,
      lat DOUBLE NULL,
      lon DOUBLE NULL,
      display_name TEXT NULL,
      fetched_at BIGINT NOT NULL
    )`,
    addColumn("sources", "relevance", "FLOAT NULL"),
    addColumn("sources", "source_type", "VARCHAR(16) NULL"),
    addColumn("sources", "url_hash", "CHAR(64) NULL"),
    addColumn("sources", "extracted_at", "BIGINT NULL"),
    `UPDATE sources SET url_hash = SHA2(SUBSTRING_INDEX(url, '#', 1), 256) WHERE url_hash IS NULL`,
    // v1 deduped by url, but drop any duplicate (keep the lowest id) so the unique key can be added.
    `UPDATE sources s JOIN (
       SELECT board_id, url_hash, MIN(CAST(SUBSTRING(id, 2) AS UNSIGNED)) AS keep_n
       FROM sources GROUP BY board_id, url_hash HAVING COUNT(*) > 1
     ) d ON d.board_id = s.board_id AND d.url_hash = s.url_hash AND CAST(SUBSTRING(s.id, 2) AS UNSIGNED) <> d.keep_n
     SET s.url_hash = SHA2(CONCAT(s.url, '#dup-', s.id), 256), s.discarded = 1`,
    addIndex("sources", "sources_url", ["board_id", "url_hash"], { unique: true }),
  ],
};
