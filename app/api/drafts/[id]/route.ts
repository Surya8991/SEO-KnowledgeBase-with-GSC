import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { drafts } from "@/lib/db/schema";
import { auth, isAuthEnabled } from "@/auth";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET   /api/drafts/:id  — UI poll (session-gated). Returns full draft body.
 * PATCH /api/drafts/:id  — worker writes back (requires X-Worker-Key).
 */

const PatchBody = z.object({
  status: z.enum(["running", "done", "failed"]),
  draftMd: z.string().max(200_000).optional(),
  model: z.string().max(120).optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  error: z.string().max(2000).optional(),
});

function workerKeyOk(req: NextRequest): boolean {
  const required = process.env.WORKER_API_KEY;
  if (!required) return false;
  return req.headers.get("x-worker-key") === required;
}

async function sessionOk(req: NextRequest): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  const session = await auth();
  return !!session?.user?.email;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idStr } = await context.params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    // Worker can also fetch its own row by id when it picks it up.
    const okSession = await sessionOk(request);
    if (!okSession && !workerKeyOk(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const row = await db.query.drafts.findFirst({ where: eq(drafts.id, id) });
    if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Read failed." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!workerKeyOk(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { id: idStr } = await context.params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = PatchBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Build patch dynamically so we never overwrite columns the worker
    // didn't include in this PATCH.
    const patch: Record<string, unknown> = { status: body.status };
    if (body.draftMd !== undefined)   patch.draftMd = body.draftMd;
    if (body.model !== undefined)     patch.model = body.model;
    if (body.tokensIn !== undefined)  patch.tokensIn = body.tokensIn;
    if (body.tokensOut !== undefined) patch.tokensOut = body.tokensOut;
    if (body.error !== undefined)     patch.error = body.error;

    if (body.status === "running") {
      patch.startedAt = new Date();
    } else if (body.status === "done" || body.status === "failed") {
      patch.completedAt = new Date();
    }

    const [row] = await db
      .update(drafts)
      .set(patch)
      .where(eq(drafts.id, id))
      .returning();

    if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Update failed." },
      { status: 500 },
    );
  }
}

// `clientIp` is imported for parity with other routes but not currently used here.
void clientIp;
