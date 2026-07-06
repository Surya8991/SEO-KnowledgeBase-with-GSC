import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  // Throw lazily at query time rather than crash module import during build.
  console.warn("[db] DATABASE_URL is not set — database calls will fail.");
}

// A syntactically valid placeholder keeps neon() from throwing at import time
// when DATABASE_URL is unset/empty (e.g. during `next build` or before .env is
// filled). `||` is intentional so an empty-string env var also falls back.
// Real queries against the placeholder fail at runtime, which is the intended
// "DB not configured" path.
const sql = neon(url || "postgresql://user:password@localhost/db");
export const db = drizzle(sql, { schema });
export { schema };

/**
 * Audit 10C tokenization (Session 8): `@neondatabase/serverless` returns
 * either a bare `T[]` (newer SDK) or `{ rows: T[] }` (older shape) from
 * `sql.query()` depending on the call path. Routes that handle both
 * littered `const data = (rows as any).rows ?? rows;` everywhere. This
 * tiny helper centralises the cast so the pattern is named instead of
 * inlined, and future SDK changes touch one file.
 */
export type NeonRowsOrWrapped<T> = T[] | { rows: T[] };

/** Normalise a Neon query result to a plain `T[]`. */
export function neonRows<T>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[];
  if (input && typeof input === "object" && "rows" in input) {
    const r = (input as { rows?: unknown }).rows;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}
