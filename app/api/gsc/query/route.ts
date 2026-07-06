import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { querySearchAnalytics, type RangeKey } from "@/lib/gsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_RANGES: RangeKey[] = ["24h", "7d", "28d", "3m", "6m", "12m"];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const range = (body.range ?? "28d") as RangeKey;
    if (!VALID_RANGES.includes(range)) {
      return NextResponse.json({ error: "Invalid range." }, { status: 400 });
    }
    const dimensions = Array.isArray(body.dimensions) ? body.dimensions : ["query"];
    const { startDate, endDate, rows } = await querySearchAnalytics({
      range,
      dimensions,
      rowLimit: Number(body.rowLimit) || 100,
    });

    // Best-effort cache into gsc_metrics (date-dimension rows only).
    if (process.env.DATABASE_URL && dimensions.includes("date")) {
      try {
        const sql = neon(process.env.DATABASE_URL);
        const site = process.env.GSC_SITE_URL || "";
        for (const r of rows) {
          await sql.query(
            `INSERT INTO gsc_metrics (site_url, date, clicks, impressions, ctr, position, range_label)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [site, r.keys?.[0] ?? null, r.clicks, r.impressions, r.ctr, r.position, range],
          );
        }
      } catch {
        /* caching is non-critical */
      }
    }

    return NextResponse.json({ range, startDate, endDate, rows });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "GSC query failed." },
      { status: 500 },
    );
  }
}
