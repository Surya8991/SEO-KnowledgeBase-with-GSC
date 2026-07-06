import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/exec";
import { toCsv } from "@/lib/csv";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Columns exported — same shape the import route expects back. */
const COLUMNS = [
  "url",
  "title",
  "h1",
  "meta_description",
  "content_type",
  "course_type",
  "category",
  "subcategory",
  "tags",
  "lastmod",
] as const;

/**
 * GET /api/pages/export — stream the corpus (respecting the same filters as
 * /api/pages) as a CSV attachment. No pagination: exports every matching row.
 *
 * Gated: exposes the entire corpus, so it requires the webhook key or a
 * session (rate-limited only in the fully-open dev/default config) rather than
 * relying on the proxy session gate, which is a no-op when AUTH_ENABLED=false.
 */
export async function GET(request: NextRequest) {
  const gate = await gateLlmEndpoint(request, "pages-export", { max: 20, windowSec: 60 });
  if (gate) return gate;
  try {
    const params = request.nextUrl.searchParams;
    const q = (params.get("q") ?? "").trim();
    const type = (params.get("type") ?? "").trim();
    const courseType = (params.get("courseType") ?? "").trim();
    const category = (params.get("category") ?? "").trim();
    const tag = (params.get("tag") ?? "").trim();
    const like = `%${q}%`;

    const res = await db.execute(sql`
      SELECT url, title, h1, meta_description, content_type, course_type,
             category, subcategory, tags, lastmod
      FROM pages
      WHERE (${q}          = '' OR title ILIKE ${like} OR url ILIKE ${like})
        AND (${type}       = '' OR content_type = ${type})
        AND (${courseType} = '' OR course_type = ${courseType})
        AND (${category}   = '' OR category    = ${category})
        AND (${tag}        = '' OR ${tag} = ANY(tags))
      ORDER BY id
    `);

    const rows = rowsOf<Record<string, unknown>>(res);
    const csv = toCsv(rows, COLUMNS as unknown as (keyof (typeof rows)[number] & string)[]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="corpus-export.csv"`,
      },
    });
  } catch (e) {
    return errorResponse("/api/pages/export", e, { status: 500, publicMessage: "Export failed." });
  }
}
