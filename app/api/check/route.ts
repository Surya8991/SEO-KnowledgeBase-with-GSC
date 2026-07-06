import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runConflictCheck } from "@/lib/conflict";
import { clientIp, consume, denied } from "@/lib/rate-limit";
import { auth, isAuthEnabled } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/check
 * Pre-publish webhook for external systems (CMS, etc.) and dashboard UI.
 *
 * Auth strategy (any ONE of the following grants access):
 *   1. Valid X-Api-Key header matching WEBHOOK_API_KEY — for CMS/webhook callers.
 *   2. Valid NextAuth session cookie (AUTH_ENABLED=true) — for dashboard users.
 *   3. Open (WEBHOOK_API_KEY unset, AUTH_ENABLED=false) — rate-limited per-IP.
 *
 * Response shape is stable:
 *   { inputType, inputValue, summary, keywords, topScore, matches[], checkId,
 *     verdict: "block" | "review" | "pass" }
 * Treat topScore >= 80 as block-publish.
 */
const BodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
  vectorLimit: z.coerce.number().int().positive().max(500).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  classifyLimit: z.coerce.number().int().positive().max(50).optional(),
  minSimilarity: z.coerce.number().min(0).max(1).optional(),
  createdBy: z.string().max(200).nullish(),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Auth — valid API key (CMS/webhook) OR valid session (dashboard) are both accepted.
    // When WEBHOOK_API_KEY is set without a matching header, fall back to session auth
    // so signed-in dashboard users are never locked out by their own webhook key.
    const required = process.env.WEBHOOK_API_KEY;
    const sentKey = required ? request.headers.get("x-api-key") : null;
    const hasValidKey = !!(required && sentKey === required);

    let sessionEmail: string | undefined;
    if (!hasValidKey) {
      if (isAuthEnabled()) {
        const session = await auth();
        sessionEmail = session?.user?.email ?? undefined;
        if (!sessionEmail) {
          return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }
      } else if (required) {
        // Key required, auth disabled, no valid key → reject.
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
      // Rate-limit session and open callers; trusted key callers skip.
      const rl = await consume(clientIp(request), "check", { max: 60, windowSec: 60 });
      if (!rl.ok) return denied(rl);
    }

    // 2. Input validation.
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // createdBy: reuse session email from auth above; never trust body-supplied value
    // (forgeable from webhook callers). Stamp anon IP when auth is disabled.
    let createdBy: string | undefined;
    if (isAuthEnabled()) {
      createdBy = sessionEmail; // undefined for webhook callers (no session)
    } else {
      createdBy = `anon:${clientIp(request)}`;
    }

    const result = await runConflictCheck(body.input, {
      vectorLimit: body.vectorLimit ?? body.limit ?? 100,
      classifyLimit: body.classifyLimit ?? 15,
      // Pass undefined so lib/conflict.ts applies its own default (audit H11).
      minSimilarity: body.minSimilarity,
      createdBy,
    });

    const verdict =
      result.topScore >= 80 ? "block" : result.topScore >= 60 ? "review" : "pass";
    return NextResponse.json({ ...result, verdict });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Conflict check failed." },
      { status: 500 },
    );
  }
}
