/**
 * Tiny normaliser for the `db.execute()` return value.
 *
 * Drizzle's neon-http driver returns `{ rows: T[] }` while older versions
 * (and the @neondatabase/serverless raw `sql.query()` path) return `T[]`
 * directly. Code was littered with `(x as any).rows ?? x` casts to paper
 * over the inconsistency — this helper centralises the unwrap and types
 * the result, so callers never write `as any` again.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const r = (result as { rows?: unknown }).rows;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}
