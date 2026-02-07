-- Upload log and rate limiting schema for reveal publishing helper.

CREATE TABLE IF NOT EXISTS upload_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commitment_hash TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_signing_key ON upload_logs(signing_key);
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON upload_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_upload_logs_key_time ON upload_logs(signing_key, created_at);
