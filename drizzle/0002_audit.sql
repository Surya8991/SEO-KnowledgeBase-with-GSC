-- Session 2: columns + tables for content audit, score history, cron snapshots.
-- Safe to re-run.

ALTER TABLE pages ADD COLUMN IF NOT EXISTS http_status     integer;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS last_audited_at timestamp;

CREATE INDEX IF NOT EXISTS pages_http_status_idx ON pages (http_status);

-- Periodic GSC snapshots (the live cache uses gsc_metrics; this stores rolled-up
-- daily totals so we can compare arbitrary windows after the fact).
CREATE TABLE IF NOT EXISTS gsc_daily_totals (
  id          serial PRIMARY KEY,
  site_url    text,
  date        text,
  clicks      real,
  impressions real,
  ctr         real,
  position    real,
  branded_clicks      real,
  branded_impressions real,
  fetched_at  timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gsc_daily_totals_idx
  ON gsc_daily_totals (site_url, date);

-- Topic clusters (one row per cluster; pages.cluster_id links rows in).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS cluster_id integer;
CREATE INDEX IF NOT EXISTS pages_cluster_idx ON pages (cluster_id);

CREATE TABLE IF NOT EXISTS clusters (
  id          serial PRIMARY KEY,
  label       text,
  size        integer,
  created_at  timestamp DEFAULT now()
);
