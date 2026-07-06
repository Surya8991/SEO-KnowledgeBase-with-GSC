import { NextRequest, NextResponse } from "next/server";
import { lookup, pageStats, queryStats } from "@/lib/gsc-page-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/gsc/lookup
 * Body: { input: string, kind?: "auto" | "url" | "query" }
 *
 * Returns { kind, data } where data is PageStats or QueryStats.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = (body.input ?? "").toString().trim();
    if (!input) return NextResponse.json({ error: "Missing 'input'." }, { status: 400 });

    const kind = (body.kind ?? "auto") as "auto" | "url" | "query";
    if (kind === "url") {
      return NextResponse.json({ kind: "url", data: await pageStats(input, 10) });
    }
    if (kind === "query") {
      return NextResponse.json({ kind: "query", data: await queryStats(input, 10) });
    }
    return NextResponse.json(await lookup(input));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
