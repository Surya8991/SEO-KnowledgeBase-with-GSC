import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";

/**
 * Postgres-backed sliding-window rate limiter — fits the existing Neon-only
 * deploy without adding Upstash/Redis. Cross-instance correct on Vercel.
 *
 * One row per (ip, route). On each call we either:
 *   - bump count if we're still inside the current window, or
 *   - reset count to 1 + advance window_start to now.
 *
 * `consume` returns `{ ok, remaining, resetIn }`. Callers convert to a 429
 * response. The DB call is one upsert; ~1ms on Neon pooled.
 */
export interface RateLimitOk {
  ok: true;
  remaining: number;
  resetIn: number;
}
export interface RateLimitDenied {
  ok: false;
  remaining: 0;
  resetIn: number;
}
export type RateLimitResult = RateLimitOk | RateLimitDenied;

interface ConsumeOpts {
  /** Max requests allowed inside the window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

/** Read the client IP off a NextRequest. Vercel sets x-forwarded-for. */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/**
 * Audit S4 (Session 6): the prior implementation failed OPEN whenever
 * DATABASE_URL was missing or the upsert threw. An attacker who could induce
 * a Neon cold-pause got unlimited LLM-burning requests. We now:
 *
 *   - Fail OPEN only in non-production (so local dev without DB still works).
 *   - In production, fall back to an in-memory token bucket per instance so a
 *     transient DB hiccup doesn't open the floodgates. The in-memory bucket
 *     is per-Vercel-function-instance — coarser than per-IP-across-fleet, but
 *     dramatically tighter than the previous unlimited fallback.
 */
const inMemoryBuckets = new Map<string, { count: number; windowStart: number }>();

function inMemoryConsume(
  ip: string,
  route: string,
  opts: ConsumeOpts,
): RateLimitResult {
  const key = `${ip}|${route}`;
  const now = Date.now();
  const bucket = inMemoryBuckets.get(key);
  const windowMs = opts.windowSec * 1000;
  if (!bucket || now - bucket.windowStart > windowMs) {
    inMemoryBuckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: opts.max - 1, resetIn: opts.windowSec };
  }
  bucket.count++;
  const resetIn = Math.max(0, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
  if (bucket.count > opts.max) return { ok: false, remaining: 0, resetIn };
  return { ok: true, remaining: Math.max(0, opts.max - bucket.count), resetIn };
}

export async function consume(
  ip: string,
  route: string,
  opts: ConsumeOpts,
): Promise<RateLimitResult> {
  const inProd = process.env.NODE_ENV === "production";

  if (!process.env.DATABASE_URL) {
    if (!inProd) {
      return { ok: true, remaining: opts.max, resetIn: opts.windowSec };
    }
    return inMemoryConsume(ip, route, opts);
  }
  const sql = neon(process.env.DATABASE_URL);

  try {
    const rows = (await sql.query(
      `
      INSERT INTO rate_limits (ip, route, count, window_start)
      VALUES ($1, $2, 1, now())
      ON CONFLICT (ip, route) DO UPDATE
        SET count = CASE
              WHEN rate_limits.window_start < now() - make_interval(secs => $3::int)
                THEN 1
              ELSE rate_limits.count + 1
            END,
            window_start = CASE
              WHEN rate_limits.window_start < now() - make_interval(secs => $3::int)
                THEN now()
              ELSE rate_limits.window_start
            END
      RETURNING count, EXTRACT(EPOCH FROM (now() - window_start))::int AS age_sec
      `,
      [ip, route, opts.windowSec],
    )) as { count: number; age_sec: number }[];

    const r = rows[0];
    if (!r) return { ok: true, remaining: opts.max, resetIn: opts.windowSec };
    const resetIn = Math.max(0, opts.windowSec - r.age_sec);
    if (r.count > opts.max) {
      return { ok: false, remaining: 0, resetIn };
    }
    return { ok: true, remaining: Math.max(0, opts.max - r.count), resetIn };
  } catch (err) {
    if (!inProd) {
      return { ok: true, remaining: opts.max, resetIn: opts.windowSec };
    }
    // Prod DB hiccup → in-memory fallback (per-instance, but bounded).
    console.warn("[rate-limit] DB failed, using in-memory bucket:", (err as Error).message);
    return inMemoryConsume(ip, route, opts);
  }
}

/** Convenience: 429 response builder. */
export function denied(result: RateLimitDenied): Response {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded.",
      retryAfterSec: result.resetIn,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.resetIn),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(result.resetIn),
      },
    },
  );
}
