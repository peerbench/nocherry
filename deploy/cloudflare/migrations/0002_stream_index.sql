-- Object format 0.5.0 (spec v0.5 12.2): one commitment per
-- (signing_key, stream_id, sequence). NULLs are distinct in a unique index,
-- so commitments outside a stream are unaffected.

ALTER TABLE commitments ADD COLUMN stream_id TEXT;
ALTER TABLE commitments ADD COLUMN sequence INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_stream
  ON commitments(signing_key, stream_id, sequence);
