-- Lock the protocol tables away from the Supabase Data API.
--
-- Supabase exposes every table in the public schema through PostgREST and grants
-- the anon and authenticated roles access by default. server_identity holds the
-- server's Ed25519 private key, so without this migration anyone holding the
-- project's public anon key could read it and forge receipts.
--
-- The edge function connects with SUPABASE_DB_URL as the table owner, which
-- bypasses row level security, so it keeps working. No policies are created on
-- purpose: with RLS enabled and no policy, API roles see nothing.
--
-- If this project was ever reachable before this migration ran, treat the server
-- key as compromised and rotate it.

ALTER TABLE commitments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE selections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE beacon_cache    ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON commitments, selections, reveals, server_identity, beacon_cache FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON commitments, selections, reveals, server_identity, beacon_cache FROM authenticated;
  END IF;
END
$$;
