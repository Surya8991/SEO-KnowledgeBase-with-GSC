import { NextRequest, NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { parseCsv } from "@/lib/csv";
import { gateWriteEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;
const BATCH = 500;

/** Optional `action` column values that mark a row for deletion. */
const DELETE_ACTIONS = new Set(["delete", "remove", "del"]);

/**
 * POST /api/pages/import — bulk add/update/remove corpus rows from a CSV.
 *
 * Body: raw CSV text (Content-Type text/csv) or multipart form-data with a
 * `file` field. Header row must include `url`; recognised columns are the
 * ones the export route emits, plus an optional `action` column:
 *   - action = delete | remove | del  → the row's `url` is deleted.
 *   - anything else / blank            → the row is upserted (add or update).
 * Only the metadata columns below are touched on upsert; embeddings/content
 * are left intact.
 *
 * Gated with gateWriteEndpoint: this bulk upserts AND deletes corpus rows, so
 * it requires the webhook key or a session (rate-limited only in the fully-open
 * dev/default config) — the proxy session gate is a no-op when AUTH is off.
 */
export async function POST(request: NextRequest) {
  const gate = await gateWriteEndpoint(request, "pages-import", { max: 10, windowSec: 60 });
  if (gate) return gate;
  try {
    const text = await readCsvBody(request);
    if (!text.trim()) {
      return NextResponse.json({ error: "Empty upload." }, { status: 400 });
    }

    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      return NextResponse.json({ error: "No data rows found." }, { status: 400 });
    }
    if (parsed.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${parsed.length}). Max ${MAX_ROWS}.` },
        { status: 400 },
      );
    }
    if (!("url" in parsed[0])) {
      return NextResponse.json(
        { error: "CSV must have a `url` column." },
        { status: 400 },
      );
    }

    const clean = (v: string | undefined) => {
      const s = (v ?? "").trim();
      return s === "" ? null : s;
    };

    const withUrl = parsed.filter((r) => (r.url ?? "").trim() !== "");

    // Rows flagged for deletion via the optional `action` column.
    const deleteUrls = Array.from(
      new Set(
        withUrl
          .filter((r) => DELETE_ACTIONS.has((r.action ?? "").trim().toLowerCase()))
          .map((r) => r.url.trim()),
      ),
    );

    const values = withUrl
      .filter((r) => !DELETE_ACTIONS.has((r.action ?? "").trim().toLowerCase()))
      .map((r) => ({
        url: r.url.trim(),
        title: clean(r.title),
        metaDescription: clean(r.meta_description),
        h1: clean(r.h1),
        contentType: clean(r.content_type) ?? "page",
        courseType: clean(r.course_type),
        category: clean(r.category),
        subcategory: clean(r.subcategory),
        tags: r.tags ? r.tags.split("|").map((t) => t.trim()).filter(Boolean) : null,
        lastmod: clean(r.lastmod),
      }));

    if (values.length === 0 && deleteUrls.length === 0) {
      return NextResponse.json({ error: "No rows with a url." }, { status: 400 });
    }

    let upserted = 0;
    for (let i = 0; i < values.length; i += BATCH) {
      const chunk = values.slice(i, i + BATCH);
      await db
        .insert(pages)
        .values(chunk)
        .onConflictDoUpdate({
          target: pages.url,
          set: {
            title: sql`excluded.title`,
            metaDescription: sql`excluded.meta_description`,
            h1: sql`excluded.h1`,
            contentType: sql`excluded.content_type`,
            courseType: sql`excluded.course_type`,
            category: sql`excluded.category`,
            subcategory: sql`excluded.subcategory`,
            tags: sql`excluded.tags`,
            lastmod: sql`excluded.lastmod`,
          },
        });
      upserted += chunk.length;
    }

    let deleted = 0;
    for (let i = 0; i < deleteUrls.length; i += BATCH) {
      const chunk = deleteUrls.slice(i, i + BATCH);
      const res = await db.delete(pages).where(inArray(pages.url, chunk)).returning({ id: pages.id });
      deleted += res.length;
    }

    return NextResponse.json({ ok: true, upserted, deleted, received: parsed.length });
  } catch (e) {
    return errorResponse("/api/pages/import", e, { status: 500, publicMessage: "Import failed." });
  }
}

/** Read CSV text from either a multipart `file` field or the raw request body. */
async function readCsvBody(request: NextRequest): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file && typeof file !== "string") return await file.text();
    return "";
  }
  return await request.text();
}
