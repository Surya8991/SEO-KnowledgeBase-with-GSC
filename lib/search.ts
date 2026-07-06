import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/exec";

interface VectorMatchRow {
  id: number;
  url: string;
  title: string | null;
  content_type: string | null;
  owner_url: string | null;
  gsc_clicks_28d: number | null;
  gsc_impressions_28d: number | null;
  snippet: string;
  similarity: number;
}

export interface VectorMatch {
  id: number;
  url: string;
  title: string | null;
  contentType: string | null;
  snippet: string;
  similarity: number; // cosine similarity 0..1
  /** Editorial owner — the URL the team has decided should rank for this
   *  topic. Null = no owner set. Drives the 'merge / redirect' UX hints. */
  ownerUrl: string | null;
  /** Last-28-day GSC clicks materialised onto the page. Used for
   *  business-impact severity weighting on each match. */
  gscClicks28d: number | null;
  gscImpressions28d: number | null;
}

/** Format a JS number[] as a pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Cosine-nearest pages to a query embedding, using pgvector's <=> operator.
 * similarity = 1 - cosine_distance. Excludes an optional URL (self-match).
 */
export async function vectorSearchPages(
  embedding: number[],
  opts: { limit?: number; excludeUrl?: string } = {},
): Promise<VectorMatch[]> {
  const limit = opts.limit ?? 10;
  const vec = toVectorLiteral(embedding);
  const exclude = opts.excludeUrl ?? "";

  const rows = await db.execute(sql`
    SELECT id, url, title, content_type,
           owner_url, gsc_clicks_28d, gsc_impressions_28d,
           left(coalesce(content_text, meta_description, ''), 600) AS snippet,
           1 - (embedding <=> ${vec}::vector) AS similarity
    FROM pages
    WHERE embedding IS NOT NULL
      AND url <> ${exclude}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);

  return rowsOf<VectorMatchRow>(rows).map((r) => ({
    id: Number(r.id),
    url: r.url,
    title: r.title,
    contentType: r.content_type,
    snippet: r.snippet ?? "",
    similarity: Number(r.similarity),
    ownerUrl: r.owner_url ?? null,
    gscClicks28d: r.gsc_clicks_28d != null ? Number(r.gsc_clicks_28d) : null,
    gscImpressions28d: r.gsc_impressions_28d != null ? Number(r.gsc_impressions_28d) : null,
  }));
}
