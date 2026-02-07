-- Support anonymous/debug uploads from unlinked Ed25519 keys
ALTER TABLE upload_logs ADD COLUMN is_anon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upload_logs ADD COLUMN expires_at TEXT;
CREATE INDEX idx_upload_logs_expires ON upload_logs(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_upload_logs_signing_key_anon ON upload_logs(signing_key) WHERE is_anon = 1;
