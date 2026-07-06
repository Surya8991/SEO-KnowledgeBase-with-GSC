/**
 * Shared cron-auth guard. Audit S1 (Session 6) — the previous
 * `if (secret && header !== ...)` pattern failed OPEN when CRON_SECRET was
 * unset, making every cron route world-reachable. This helper fails CLOSED:
 * missing or mismatched secret returns 401.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when the
 * env var is configured in Project → Settings → Environment Variables.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export function requireCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : null;
  // timingSafeEqual prevents timing side-channels that would let an attacker
  // infer the secret length or prefix via response-time differences (M1).
  const ok =
    expected !== null &&
    header !== null &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
