-- Wisersell sync hafif audit log
-- Her sync için inserted/updated sayıları + ilk 100 değişikliğin örnek diff'i
-- Run: ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /tmp/wisersell_sync_log.sql"

CREATE TABLE IF NOT EXISTS wisersell_sync_log (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  inserted_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  sample_changes JSONB,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS wisersell_sync_log_started_idx
  ON wisersell_sync_log (started_at DESC);
