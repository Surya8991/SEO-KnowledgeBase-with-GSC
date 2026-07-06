import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";
import { log } from "@/lib/logger";

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

/**
 * Read the trustworthy client IP off a NextRequest.
 *
 * Audit H3 (Session 11): the previous implementation took the LEFTMOST
 * `x-forwarded-for` value, which is fully attacker-controlled — a client can
 * send `X-Forwarded-For: <random>` and the trusted proxy only *appends* to it.
 * Rotating that header gave every request a fresh rate-limit bucket, defeating
 * the limiter (the only protection on the LLM/write endpoints when
 * WEBHOOK_API_KEY is unset).
 *
 * On Vercel the platform sets `x-real-ip` to the true client IP and appends
 * the real IP as the RIGHTMOST hop of `x-forwarded-for`. So we trust, in order:
 *   1. `x-real-ip` (Vercel/most reverse proxies set this to the real client).
 *   2. the rightmost `x-forwarded-for` entry (the hop added by the proxy
 *      nearest us — the one value an external client cannot forge).
 * We deliberately ignore the leftmost XFF value.
 *
 * NOTE: if this ever runs behind >1 trusted proxy, widen the trusted-hop count
 * accordingly — but never trust the leftmost entry.
 */
export function clientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
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
    log.warn("rate-limit: DB failed, using in-memory bucket", { error: (err as Error).message });
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
