-- Audit H8 (Session 6): persist the enrichment fields that
-- ConflictMatchResult already carries in the API response so the history
-- view doesn't lose them. Also indexes owner_url for "show me cannibals
-- of a winner" reverse lookups.
ALTER TABLE check_matches ADD COLUMN IF NOT EXISTS overlap        text[];
ALTER TABLE check_matches ADD COLUMN IF NOT EXISTS issue          text;
ALTER TABLE check_matches ADD COLUMN IF NOT EXISTS owner_url      text;
ALTER TABLE check_matches ADD COLUMN IF NOT EXISTS gsc_clicks_28d integer;

CREATE INDEX IF NOT EXISTS check_matches_owner_url_idx ON check_matches (owner_url);
