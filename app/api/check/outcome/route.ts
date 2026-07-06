import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { gateLlmEndpoint } from "@/lib/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/check/outcome
 * Body: { checkId: number, outcome: 'published' | 'merged' | 'redirected' | 'discarded' | null }
 *
 * Records what the editor actually did with the check result so leadership
 * can answer 'how many duplicates did we catch this quarter?' (#36).
 */
const BodySchema = z.object({
  checkId: z.coerce.number().int().positive(),
  outcome: z.enum(["published", "merged", "redirected", "discarded"]).nullable(),
});

export async function POST(request: NextRequest) {
  // H4: gate unconditionally — when WEBHOOK_API_KEY is unset we fall back to
  // rate-limiting (60 req/min) instead of leaving the endpoint open for
  // arbitrary DB row updates with zero auth and zero rate-limit.
  const gate = await gateLlmEndpoint(request, "check-outcome", { max: 60, windowSec: 60 });
  if (gate) return gate;
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body.", issues: parsed.error.issues }, { status: 400 });
    }
    const { checkId, outcome } = parsed.data;
    const sql = neon(process.env.DATABASE_URL!);
    await sql.query(
      `UPDATE checks
          SET outcome = $1,
              resolved_at = CASE WHEN $1 IS NULL THEN NULL ELSE now() END
        WHERE id = $2`,
      [outcome, checkId],
    );
    return NextResponse.json({ ok: true, checkId, outcome });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
