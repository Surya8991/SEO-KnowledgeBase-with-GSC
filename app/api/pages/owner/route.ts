import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { gateWriteEndpoint } from "@/lib/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pages/owner
 * Body: { url: string, ownerUrl: string | null }
 * Set or clear the editorial owner for a page (#25).
 *
 * Write endpoint: requires a webhook key or a signed-in session (audit H4);
 * falls back to per-IP rate-limit only when neither auth mechanism is
 * configured (dev/default).
 */
const BodySchema = z.object({
  url: z.string().url(),
  ownerUrl: z.string().url().nullable(),
});

export async function POST(request: NextRequest) {
  // H4: writes owner_url (drives redirect-suggestion logic) — require webhook
  // key or session when configured; rate-limit only in the fully-open config.
  const gate = await gateWriteEndpoint(request, "pages-owner", { max: 60, windowSec: 60 });
  if (gate) return gate;
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body.", issues: parsed.error.issues }, { status: 400 });
    }
    const { url, ownerUrl } = parsed.data;
    const sql = neon(process.env.DATABASE_URL!);
    const result = (await sql.query(
      `UPDATE pages SET owner_url = $1 WHERE url = $2 RETURNING id`,
      [ownerUrl, url],
    )) as any[];
    if (!result.length) {
      return NextResponse.json({ error: "Page not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, url, ownerUrl });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
