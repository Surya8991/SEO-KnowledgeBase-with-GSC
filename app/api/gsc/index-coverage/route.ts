import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, neonRows } from "@/lib/db";
import { indexCoverage } from "@/lib/gsc-insights";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/gsc/index-coverage
 * Body: { sample?: number, contentType?: string }
 *   Inspects up to `sample` (default 25) URLs from the corpus and reports
 *   whether each is indexed in Google. GSC quota: 600 inspections/day per site.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sample = Math.min(Math.max(Number(body.sample) || 25, 1), 100);
    const type = (body.contentType ?? "").toString();
    const rows = await db.execute(sql`
      SELECT url FROM pages
      WHERE (${type} = '' OR content_type = ${type})
      ORDER BY random()
      LIMIT ${sample}
    `);
    const urls: string[] = neonRows<{ url: string }>(rows).map((r) => r.url);
    const results = await indexCoverage(urls);
    const buckets: Record<string, number> = {};
    for (const r of results) buckets[r.verdict] = (buckets[r.verdict] ?? 0) + 1;
    return NextResponse.json({ sample: urls.length, buckets, results });
  } catch (e) {
    return errorResponse("/api/gsc/index-coverage", e, {
      status: 500,
      publicMessage: "Request failed.",
    });
  }
}
