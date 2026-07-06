-- Batch 15: pre-generated draft library.
--
-- Pre-generation pipeline (`npm run pregen-drafts`) writes 1 row per
-- high-value page using local Claude (Max 20x quota, no API cost). At
-- runtime, /api/drafts does vector search against this table and returns
-- the nearest match instantly when similarity >= 0.85. Below that, the
-- runtime path calls Groq to adapt the nearest match or generate fresh,
-- then writes the result back so the next request hits cache.

CREATE TABLE IF NOT EXISTS pregenerated_drafts (
  id            SERIAL PRIMARY KEY,

  -- What this draft is about. `topic` is human-readable; `source_url` is
  -- the page in our corpus it was pre-generated FOR (NULL for drafts
  -- that came in via runtime Groq generation, since those have no
  -- pre-existing source).
  topic         TEXT NOT NULL,
  source_url    TEXT,

  -- The Markdown article + its embedding. vector(384) matches the rest
  -- of the corpus (bge-small-en-v1.5). EMBED_DIM in lib/db/schema.ts.
  draft_md      TEXT NOT NULL,
  embedding     vector(384) NOT NULL,

  -- Provenance — which model wrote this row, when, and a short context
  -- hash so refresh runs can detect drift.
  model         TEXT NOT NULL,
  context_hash  TEXT,
  tokens_in     INTEGER,
  tokens_out    INTEGER,

  generated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- HNSW index on the embedding for fast cosine-similarity lookups.
-- Matches the pattern used by the `pages` table.
CREATE INDEX IF NOT EXISTS pregenerated_drafts_embedding_idx
  ON pregenerated_drafts USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS pregenerated_drafts_source_url_idx
  ON pregenerated_drafts (source_url);

CREATE INDEX IF NOT EXISTS pregenerated_drafts_generated_at_idx
  ON pregenerated_drafts (generated_at DESC);

-- Soft-uniqueness: one cached row per source_url. Re-running pregen for
-- a URL UPSERTs the new draft. Drafts with NULL source_url (Groq-cached
-- ones) can have duplicates, which is fine — vector search dedupes by
-- picking the highest-similarity row.
CREATE UNIQUE INDEX IF NOT EXISTS pregenerated_drafts_source_url_unique
  ON pregenerated_drafts (source_url) WHERE source_url IS NOT NULL;
