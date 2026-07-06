-- Simple sliding-window rate limit table.
-- One row per (ip, route) tracking request count + window start.
-- Cron / lazy cleanup deletes rows whose window_start is older than
-- the max enforced window. Idempotent.

CREATE TABLE IF NOT EXISTS rate_limits (
  ip            text        NOT NULL,
  route         text        NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, route)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
