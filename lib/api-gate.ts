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
    if (sent !== required) {
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
