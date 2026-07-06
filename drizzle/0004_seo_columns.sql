-- Columns added during the SEO-features sprint (Batches D + E).
-- All nullable / default-safe so re-running ingest doesn't blow up.

-- #25 Owner-URL per topic.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_url text;
CREATE INDEX IF NOT EXISTS pages_owner_url_idx ON pages (owner_url);

-- #26 Business-impact severity — last-28-day GSC totals materialised onto the
-- page row so the conflict checker can score by traffic value without
-- re-joining gsc_metrics on every request.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS gsc_clicks_28d      integer;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS gsc_impressions_28d integer;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS gsc_position_28d    real;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS gsc_synced_at       timestamptz;
CREATE INDEX IF NOT EXISTS pages_gsc_clicks_idx ON pages (gsc_clicks_28d DESC NULLS LAST);

-- #32 Canonical-tag check.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS canonical_url text;

-- #41 Image SEO check.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_count    integer;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS images_no_alt  integer;

-- #28 Stale-content detector (boolean snapshot computed by the
-- gsc-snapshot cron from sliding-window clicks + lastmod age).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS is_stale       boolean DEFAULT false;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS stale_reason   text;

-- #9A item 8 — filter-column indexes for /api/pages perf.
CREATE INDEX IF NOT EXISTS pages_content_type_idx ON pages (content_type);
CREATE INDEX IF NOT EXISTS pages_course_type_idx_v2 ON pages (course_type);
CREATE INDEX IF NOT EXISTS pages_category_idx_v2 ON pages (category);

-- #36 Shipped-vs-blocked reporting — flag whether a check turned into a
-- published page so leadership can report 'we caught N this quarter'.
-- outcome values: 'published' | 'merged' | 'redirected' | 'discarded' | null
ALTER TABLE checks ADD COLUMN IF NOT EXISTS verdict     text;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS outcome     text;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
