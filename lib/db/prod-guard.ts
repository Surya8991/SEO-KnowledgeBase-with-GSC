/**
 * Production-write guard for destructive maintenance scripts (audit H5, Session 11).
 *
 * There is one shared Neon project that is production. Nothing in code stopped
 * a dev from pointing `DATABASE_URL` at it and running a destructive script
 * (`cleanup-junk-pages --delete`, `reclassify-home`) — the only protection was
 * operator discipline. This helper turns that into an enforced check.
 *
 * Enforcement is OPT-IN via `PROD_DATABASE_HOST`:
 *   - If `PROD_DATABASE_HOST` is set and the current `DATABASE_URL` host matches
 *     it, destructive scripts REFUSE to run unless `ALLOW_PROD_WRITES=1`.
 *   - If `PROD_DATABASE_HOST` is unset, the guard cannot know which host is prod,
 *     so it logs a warning and allows the run (non-breaking for setups that have
 *     not configured it yet). Configure it to get real protection.
 *
 * Call `assertProdWritesAllowed("delete N junk pages")` immediately before the
 * destructive statement — it throws (aborting the script) when blocked.
 */

export function currentDbHost(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function assertProdWritesAllowed(action: string): void {
  const prodHost = process.env.PROD_DATABASE_HOST?.trim().toLowerCase();
  const host = currentDbHost();

  if (!prodHost) {
    console.warn(
      `[prod-guard] PROD_DATABASE_HOST is not set — cannot verify whether ` +
        `"${host ?? "unknown"}" is production. Proceeding with: ${action}. ` +
        `Set PROD_DATABASE_HOST to enforce this guard.`,
    );
    return;
  }

  if (host && host === prodHost && process.env.ALLOW_PROD_WRITES !== "1") {
    throw new Error(
      `Refusing destructive operation against the production database ` +
        `(${host}): ${action}. Re-run with ALLOW_PROD_WRITES=1 if this is intentional.`,
    );
  }
}
