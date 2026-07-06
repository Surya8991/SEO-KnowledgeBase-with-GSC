import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runConflictCheck } from "@/lib/conflict";
import { clientIp, consume, denied } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/check/bulk
 * Body: { inputs: string[], limit?: number, concurrency?: number }
 * Returns: { results: Array<{input, ok, topScore, verdict, summary?, error?}> }
 *
 * Same auth strategy as /api/check — WEBHOOK_API_KEY if set, otherwise
 * rate-limited per-IP. Bulk gets a tighter window (10 calls per 5 minutes)
 * because each call can fan out to 50+ inputs.
 */
const BodySchema = z.object({
  inputs: z.array(z.string().trim().min(1).max(4000)).min(1).max(100),
  limit: z.coerce.number().int().positive().max(500).optional(),
  concurrency: z.coerce.number().int().min(1).max(6).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const required = process.env.WEBHOOK_API_KEY;
    if (required) {
      const sent = request.headers.get("x-api-key");
      if (sent !== required) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
    } else {
      const rl = await consume(clientIp(request), "check-bulk", { max: 10, windowSec: 300 });
      if (!rl.ok) return denied(rl);
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { inputs, limit = 5, concurrency = 3 } = parsed.data;

    const queue = inputs.map((s) => s.trim()).filter(Boolean);
    const results: any[] = new Array(queue.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        const input = queue[idx]!;
        try {
          const r = await runConflictCheck(input, { limit });
          const verdict =
            r.topScore >= 80 ? "block" : r.topScore >= 60 ? "review" : "pass";
          results[idx] = {
            input,
            ok: true,
            topScore: r.topScore,
            verdict,
            summary: r.summary,
            topMatchUrl: r.matches[0]?.url ?? null,
            topMatchTitle: r.matches[0]?.title ?? null,
            topMatchType: r.matches[0]?.conflictType ?? null,
            checkId: r.checkId ?? null,
          };
        } catch (e) {
          results[idx] = { input, ok: false, error: (e as Error).message };
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Bulk check failed." },
      { status: 500 },
    );
  }
}
