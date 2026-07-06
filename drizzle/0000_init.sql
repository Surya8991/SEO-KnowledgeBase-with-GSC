-- Conflict Checker schema init. Run with: npm run db:setup
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS pages (
  id              serial PRIMARY KEY,
  url             text NOT NULL,
  title           text,
  meta_description text,
  h1              text,
  content_text    text,
  content_type    text DEFAULT 'page',
  category        text,
  subcategory     text,
  lastmod         text,
  embedding       vector(384),
  token_count     integer,
  crawled_at      timestamp,
  created_at      timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_url_idx ON pages (url);
CREATE INDEX IF NOT EXISTS pages_content_type_idx ON pages (content_type);
CREATE INDEX IF NOT EXISTS pages_embedding_idx
  ON pages USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS checks (
  id                  serial PRIMARY KEY,
  input_type          text NOT NULL,
  input_value         text NOT NULL,
  summary             text,
  keywords            text,
  candidate_embedding vector(384),
  top_score           real,
  created_by          text,
  created_at          timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS check_matches (
  id            serial PRIMARY KEY,
  check_id      integer NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  page_id       integer REFERENCES pages(id) ON DELETE SET NULL,
  page_url      text,
  page_title    text,
  similarity    real,
  conflict_score integer,
  conflict_type text,
  rationale     text,
  rank          integer
);
CREATE INDEX IF NOT EXISTS check_matches_check_idx ON check_matches (check_id);

CREATE TABLE IF NOT EXISTS gsc_connections (
  id           serial PRIMARY KEY,
  user_email   text,
  site_url     text,
  access_token text,
  refresh_token text,
  expiry       timestamp,
  scope        text,
  created_at   timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gsc_metrics (
  id          serial PRIMARY KEY,
  site_url    text,
  page        text,
  query       text,
  clicks      real,
  impressions real,
  ctr         real,
  position    real,
  date        text,
  range_label text,
  fetched_at  timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gsc_metrics_date_page_idx ON gsc_metrics (date, page);

CREATE TABLE IF NOT EXISTS catalog_conflicts (
  id         serial PRIMARY KEY,
  a_id       integer,
  a_url      text,
  a_title    text,
  a_type     text,
  b_id       integer,
  b_url      text,
  b_title    text,
  b_type     text,
  similarity real,
  pair_type  text,
  computed_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_conflicts_sim_idx ON catalog_conflicts (similarity);

CREATE TABLE IF NOT EXISTS competitors (
  id                 serial PRIMARY KEY,
  topic              text NOT NULL,
  competitor_url     text,
  title              text,
  summary            text,
  domain             text,
  est_authority      text,
  is_known_competitor integer DEFAULT 0,
  source             text,
  created_at         timestamp DEFAULT now()
);
