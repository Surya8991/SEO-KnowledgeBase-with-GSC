import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, neonRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/check/history?input=<text or url>&limit=20
 *   No input → recent checks grouped by input_value with score trend.
 *   With input → full history for that one input + the latest matches.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const input = (params.get("input") ?? "").trim();
    const limit = Math.min(Number(params.get("limit")) || 50, 200);

    if (!input) {
      // Recent — one row per input_value with run count + most recent + trend.
      const rows = await db.execute(sql`
        SELECT input_value,
               input_type,
               count(*)::int AS runs,
               max(created_at) AS last_run,
               min(top_score) AS min_score,
               max(top_score) AS max_score,
               (array_agg(top_score ORDER BY created_at DESC))[1] AS last_score
        FROM checks
        WHERE input_value <> ''
        GROUP BY input_value, input_type
        ORDER BY last_run DESC
        LIMIT ${limit}
      `);
      return NextResponse.json({ rows: neonRows(rows) });
    }

    const history = await db.execute(sql`
      SELECT id, input_type, input_value, summary, top_score, created_at, outcome
      FROM checks
      WHERE input_value = ${input}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);
    const histRows = neonRows(history);
    const latest = (histRows as any[])[histRows.length - 1];
    let matches: any[] = [];
    if (latest) {
      const m = await db.execute(sql`
        SELECT page_url, page_title, similarity, conflict_score, conflict_type, rationale, rank
        FROM check_matches
        WHERE check_id = ${latest.id}
        ORDER BY rank ASC
      `);
      matches = (m as any).rows ?? m;
    }
    return NextResponse.json({ history: histRows, latest, matches });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, rows: [] },
      { status: 500 },
    );
  }
}
