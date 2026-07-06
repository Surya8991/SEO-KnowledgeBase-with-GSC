import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, neonRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 100, 500);
    const rows = await db.execute(sql`
      SELECT a_url, a_title, a_type, b_url, b_title, b_type, similarity, pair_type
      FROM catalog_conflicts
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);
    return NextResponse.json({ rows: neonRows(rows) });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, rows: [] },
      { status: 500 },
    );
  }
}
