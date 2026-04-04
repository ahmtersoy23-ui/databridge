CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running | success | failed | skipped
  rows_processed INTEGER,
  error_message TEXT,
  duration_ms INTEGER
);

CREATE INDEX idx_sync_log_job_name ON sync_log (job_name, started_at DESC);
