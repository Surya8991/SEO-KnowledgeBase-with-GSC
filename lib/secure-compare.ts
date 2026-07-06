/**
 * Constant-time string comparison for secrets (audit H2, Session 11).
 *
 * Plain `a === b` / `a !== b` on strings short-circuits at the first differing
 * byte, leaking the secret's length and matching prefix through response
 * timing. Every API-key / worker-key check must go through this helper so it
 * behaves like the already-hardened cron-auth guard (`lib/cron-auth.ts`).
 *
 * Returns false (never throws) when either side is missing, so callers can use
 * it directly in an auth predicate without extra null-guards.
 */
import { timingSafeEqual } from "node:crypto";

export function secureEquals(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch — length itself is not secret,
  // but the byte comparison must stay constant-time, so compare a fixed-size
  // digest-free proxy: bail on length first, then constant-time compare equal
  // lengths. Length check is O(1) and reveals only length, matching the
  // cron-auth precedent.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
