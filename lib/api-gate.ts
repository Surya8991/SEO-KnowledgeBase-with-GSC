/**
 * Shared API gate for LLM-burning endpoints (audit S3, Session 6).
 *
 * Mirrors the pattern in /api/check:
 *   - If WEBHOOK_API_KEY is set, callers MUST send a matching X-API-Key header.
 *   - Otherwise, per-IP rate-limit (default 30 req/min for AI endpoints, half
 *     the /api/check budget because each call here is more expensive).
 *
 * Use at the top of POST handlers:
 *   const gate = await gateLlmEndpoint(request, "summarize");
 *   if (gate) return gate;
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientIp, consume, denied } from "@/lib/rate-limit";
import { secureEquals } from "@/lib/secure-compare";
import { auth, isAuthEnabled } from "@/auth";

export interface GateOpts {
  /** Max requests per window when WEBHOOK_API_KEY is unset. */
  max?: number;
  windowSec?: number;
}

export async function gateLlmEndpoint(
  request: NextRequest,
  route: string,
  opts: GateOpts = {},
): Promise<NextResponse | null> {
  const required = process.env.WEBHOOK_API_KEY;
  if (required) {
    const sent = request.headers.get("x-api-key");
    if (!secureEquals(sent, required)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return null;
  }
  const rl = await consume(clientIp(request), route, {
    max: opts.max ?? 30,
    windowSec: opts.windowSec ?? 60,
  });
  if (!rl.ok) return denied(rl) as NextResponse;
  return null;
}

/**
 * Gate for state-CHANGING endpoints (DB writes) — audit H4, Session 11.
 *
 * Unlike gateLlmEndpoint (which degrades straight to rate-limit when
 * WEBHOOK_API_KEY is unset), a write endpoint must require a real identity
 * whenever one is available. Access is granted by the FIRST of:
 *   1. Valid X-Api-Key matching WEBHOOK_API_KEY (webhook/CMS callers).
 *   2. Valid NextAuth session (dashboard users, when AUTH_ENABLED=true).
 *   3. Only if NEITHER a key is configured NOR auth is enabled (fully open
 *      dev/default config): per-IP rate-limit as a floor.
 *
 * So a dashboard-only prod (AUTH_ENABLED=true, no webhook key) now REQUIRES a
 * session for writes instead of accepting any rate-limited anonymous caller.
 * Mirrors the auth ladder in /api/check.
 */
export async function gateWriteEndpoint(
  request: NextRequest,
  route: string,
  opts: GateOpts = {},
): Promise<NextResponse | null> {
  const required = process.env.WEBHOOK_API_KEY;

  // 1. Trusted webhook key.
  if (required && secureEquals(request.headers.get("x-api-key"), required)) {
    return null;
  }

  // 2. Signed-in dashboard session.
  if (isAuthEnabled()) {
    const session = await auth();
    if (session?.user?.email) return null;
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // 3. Key is configured but was not presented, and auth is off → reject
  //    (don't silently fall through to an open rate-limit).
  if (required) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // 4. Fully open config (no key, no auth) → rate-limit floor.
  const rl = await consume(clientIp(request), route, {
    max: opts.max ?? 60,
    windowSec: opts.windowSec ?? 60,
  });
  if (!rl.ok) return denied(rl) as NextResponse;
  return null;
}
