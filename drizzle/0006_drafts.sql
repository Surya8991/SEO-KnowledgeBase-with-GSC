-- Batch 11: AI-generated drafts queue + storage.
--
-- Decoupled worker model: web UI inserts a queued row, local CLI worker
-- (scripts/draft-worker.ts) polls, invokes Claude Code on the operator's
-- machine, and PATCHes the markdown back. Web UI polls the row for status.
--
-- We never call Claude server-side; that keeps the LLM cost on the
-- operator's Max 20x subscription instead of burning an API key.

CREATE TABLE IF NOT EXISTS drafts (
  id              SERIAL PRIMARY KEY,
  check_id        INTEGER REFERENCES checks(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  brief_md        TEXT NOT NULL,                  -- the prompt context handed to Claude
  draft_md        TEXT,                            -- the generated draft (populated by worker)
  model           TEXT,                            -- e.g. 'claude-sonnet-4-6'
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  error           TEXT,                            -- error string when status = 'failed'
  requested_by    TEXT,                            -- session email or anon:<ip>
  requested_at    TIMESTAMP DEFAULT NOW(),
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS drafts_status_idx       ON drafts (status, requested_at);
CREATE INDEX IF NOT EXISTS drafts_check_id_idx     ON drafts (check_id);
CREATE INDEX IF NOT EXISTS drafts_requested_at_idx ON drafts (requested_at DESC);
