import type { Migration } from "./steps";

// Job queue, run checkpoints and worker heartbeats (guide P2-1, P2-2, P6-5).
export const m002: Migration = {
  id: 2,
  name: "runtime",
  up: [
    `CREATE TABLE IF NOT EXISTS jobs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(16) NOT NULL,
      board_id VARCHAR(32) NOT NULL,
      payload LONGTEXT,
      status VARCHAR(16) NOT NULL,
      priority INT NOT NULL DEFAULT 0,
      run_after BIGINT NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      locked_by VARCHAR(64),
      heartbeat_at BIGINT,
      error TEXT,
      created_at BIGINT NOT NULL,
      finished_at BIGINT,
      INDEX jobs_claim (status, run_after, priority),
      INDEX jobs_board (board_id, status)
    )`,
    `CREATE TABLE IF NOT EXISTS runs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      board_id VARCHAR(32) NOT NULL,
      job_id BIGINT NOT NULL,
      graph VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL,
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      error TEXT,
      INDEX runs_board (board_id, id),
      INDEX runs_job (job_id)
    )`,
    `CREATE TABLE IF NOT EXISTS run_steps (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      run_id BIGINT NOT NULL,
      node VARCHAR(48) NOT NULL,
      step_key VARCHAR(191) NOT NULL,
      status VARCHAR(16) NOT NULL,
      attempt INT NOT NULL DEFAULT 1,
      input_hash CHAR(64) NOT NULL,
      output LONGTEXT,
      model VARCHAR(64),
      tokens_in INT,
      tokens_out INT,
      context_calls INT,
      started_at BIGINT NOT NULL,
      ms INT,
      error TEXT,
      UNIQUE KEY run_step (run_id, node, step_key),
      INDEX run_steps_started (started_at)
    )`,
    `CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_id VARCHAR(64) PRIMARY KEY,
      ts BIGINT NOT NULL,
      info TEXT
    )`,
  ],
};
