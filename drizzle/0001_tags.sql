-- Adds taxonomy columns: free-form tags + structured course_type.
-- Safe to re-run.

ALTER TABLE pages ADD COLUMN IF NOT EXISTS tags        text[];
ALTER TABLE pages ADD COLUMN IF NOT EXISTS course_type text;

-- Existing rows that haven't been re-tagged should look like "static" by default;
-- scripts/backfill-tags.ts then promotes them to course/blog/category/etc.
ALTER TABLE pages ALTER COLUMN content_type SET DEFAULT 'static';

CREATE INDEX IF NOT EXISTS pages_tags_idx        ON pages USING gin (tags);
CREATE INDEX IF NOT EXISTS pages_course_type_idx ON pages (course_type);
CREATE INDEX IF NOT EXISTS pages_category_idx    ON pages (category);
