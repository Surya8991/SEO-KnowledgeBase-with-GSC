import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim();
    const type = (params.get("type") ?? "").trim();
    const courseType = (params.get("courseType") ?? "").trim();
    const category = (params.get("category") ?? "").trim();
    const tag = (params.get("tag") ?? "").trim();
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200);
    const page  = Math.max(Number(params.get("page")) || 1, 1);
    const offset = Number(params.get("offset")) || (page - 1) * limit;

    const like = `%${q}%`;
    const rows = await db.execute(sql`
      SELECT id, url, title, content_type, course_type, category, subcategory,
             tags, lastmod, token_count, (embedding IS NOT NULL) AS embedded,
             owner_url, gsc_clicks_28d, gsc_impressions_28d, gsc_position_28d,
             canonical_url, image_count, images_no_alt, is_stale, stale_reason
      FROM pages
      WHERE (${q}          = '' OR title ILIKE ${like} OR url ILIKE ${like})
        AND (${type}       = '' OR content_type = ${type})
        AND (${courseType} = '' OR course_type = ${courseType})
        AND (${category}   = '' OR category    = ${category})
        AND (${tag}        = '' OR ${tag} = ANY(tags))
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `);

    const totalRows = await db.execute(sql`
      SELECT count(*)::int AS total FROM pages
      WHERE (${q}          = '' OR title ILIKE ${like} OR url ILIKE ${like})
        AND (${type}       = '' OR content_type = ${type})
        AND (${courseType} = '' OR course_type = ${courseType})
        AND (${category}   = '' OR category    = ${category})
        AND (${tag}        = '' OR ${tag} = ANY(tags))
    `);

    const byType = await db.execute(sql`
      SELECT content_type, count(*)::int AS n
      FROM pages
      GROUP BY content_type
      ORDER BY n DESC
    `);

    const byCourseType = await db.execute(sql`
      SELECT course_type, count(*)::int AS n
      FROM pages
      WHERE course_type IS NOT NULL
      GROUP BY course_type
      ORDER BY n DESC
    `);

    const topCategories = await db.execute(sql`
      SELECT category, count(*)::int AS n
      FROM pages
      WHERE category IS NOT NULL
      GROUP BY category
      ORDER BY n DESC
      LIMIT 25
    `);

    const data = rowsOf<Record<string, unknown>>(rows);
    const total = rowsOf<{ total: number }>(totalRows)[0]?.total ?? 0;
    const byTypeArr = rowsOf<{ content_type: string; n: number }>(byType);
    const byCourseTypeArr = rowsOf<{ course_type: string; n: number }>(byCourseType);
    const topCategoriesArr = rowsOf<{ category: string; n: number }>(topCategories);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return NextResponse.json({
      total,
      rows: data,
      byType: byTypeArr,
      byCourseType: byCourseTypeArr,
      topCategories: topCategoriesArr,
      page,
      pageSize: limit,
      totalPages,
      offset,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, rows: [], total: 0, byType: [], byCourseType: [], topCategories: [], page: 1, totalPages: 1 },
      { status: 500 },
    );
  }
}
