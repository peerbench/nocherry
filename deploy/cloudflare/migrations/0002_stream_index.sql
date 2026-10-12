-- Object format 0.5.0 (spec v0.5 12.2): one commitment per
-- (signing_key, stream_id, sequence). The row has no foreign key to
-- commitments and is not purged with them, so a name stays taken after the
-- commitment body has left the retention window.

CREATE TABLE IF NOT EXISTS stream_index (
  signing_key TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  commitment_hash TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  PRIMARY KEY (signing_key, stream_id, sequence)
);
