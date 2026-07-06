/**
 * Uniform error response for API routes (audit M4, Session 11).
 *
 * Returning `(e as Error).message` to the client leaks internals: DB error
 * strings, and — critically — the SSRF guard's "resolves to forbidden 10.x.x.x"
 * messages, which let an attacker map the internal network by blind probing.
 * This helper logs the real error server-side (via lib/logger) and returns a
 * generic, caller-safe message with the original status and any extra fields
 * the response shape requires (e.g. `rows: []`).
 */
import { NextResponse } from "next/server";
import { log } from "@/lib/logger";

export interface ErrorResponseOpts {
  /** HTTP status (default 500). */
  status?: number;
  /** Client-facing message (default "Internal error."). Keep it generic. */
  publicMessage?: string;
  /** Extra top-level fields to preserve the route's response shape. */
  extra?: Record<string, unknown>;
}

export function errorResponse(
  route: string,
  e: unknown,
  opts: ErrorResponseOpts = {},
): NextResponse {
  const status = opts.status ?? 500;
  log.error(`${route} failed`, {
    error: e instanceof Error ? e.message : String(e),
    status,
  });
  return NextResponse.json(
    { error: opts.publicMessage ?? "Internal error.", ...(opts.extra ?? {}) },
    { status },
  );
}
