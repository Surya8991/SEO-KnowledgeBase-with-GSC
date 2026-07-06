import { NextRequest, NextResponse } from "next/server";
import { pageStats, pageStatsBatch } from "@/lib/gsc-page-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/gsc/page-stats
 * Body: { url?: string, urls?: string[], topN?: number }
 *   - With a single url → returns PageStats.
 *   - With urls[] → returns { results: PageStats[] }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const topN = Math.min(Math.max(Number(body.topN) || 3, 1), 10);
    if (Array.isArray(body.urls) && body.urls.length) {
      return NextResponse.json({ results: await pageStatsBatch(body.urls.slice(0, 12), topN) });
    }
    const url = (body.url ?? "").toString();
    if (!url) return NextResponse.json({ error: "Missing 'url' or 'urls'." }, { status: 400 });
    return NextResponse.json(await pageStats(url, topN));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
