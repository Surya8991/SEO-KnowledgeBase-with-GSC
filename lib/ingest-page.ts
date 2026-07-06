/**
 * Audit H10 (Session 6): shared ingest-one-page primitive used by both
 * scripts/ingest.ts (bulk worker pool) and app/api/cron/reingest/route.ts
 * (Vercel-cron worker pool). Previously the cron version ran a serial
 * for-loop over the entire sitemap inside a single 300s function —
 * ~1,500 URLs × ~500ms each = guaranteed timeout. The script had its own
 * worker pool but didn't share code.
 *
 * `ingestOne` takes the embed function as a dependency so the script can
 * pass its already-initialised local model and the cron route can call
 * getEmbedder() — same query plan either way.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { fetchAndExtract, estimateTokens } from "./extract";
import { tagUrl } from "./taxonomy";
import { toVectorLiteral } from "./search";
import type { EmbeddingProvider } from "./ai";

export interface SitemapEntry {
  url: string;
  lastmod?: string | null;
}

export type IngestOutcome = "done" | "skipped" | "failed";

export interface IngestDeps {
  sql: NeonQueryFunction<false, false>;
  embedder: EmbeddingProvider;
}

/**
 * Insert/update a single page. Returns "skipped" when the sitemap lastmod
 * matches the stored row (and an embedding already exists, when the caller
 * passes `checkExistingEmbedding: true`).
 */
export async function ingestOne(
  entry: SitemapEntry,
  deps: IngestDeps,
  opts: { checkExistingEmbedding?: boolean } = {},
): Promise<IngestOutcome> {
  const { sql, embedder } = deps;
  if (opts.checkExistingEmbedding) {
    const existing = (await sql.query(
      "SELECT lastmod, (embedding IS NOT NULL) AS has_emb FROM pages WHERE url = $1",
      [entry.url],
    )) as { lastmod: string | null; has_emb: boolean }[];
    const row = existing[0];
    if (row?.has_emb && entry.lastmod && row.lastmod === entry.lastmod) {
      return "skipped";
    }
  } else {
    const existing = (await sql.query(
      "SELECT lastmod FROM pages WHERE url = $1",
      [entry.url],
    )) as { lastmod: string | null }[];
    if (existing[0]?.lastmod && entry.lastmod && existing[0].lastmod === entry.lastmod) {
      return "skipped";
    }
  }

  const page = await fetchAndExtract(entry.url);
  const text = [page.title, page.h1, page.contentText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);
  if (!text.trim()) return "failed";

  const [embedding] = await embedder.embed([text]);
  if (!embedding) return "failed";
  const tagged = tagUrl(entry.url, page.title);

  await sql.query(
    `INSERT INTO pages
       (url, title, meta_description, h1, content_text,
        content_type, course_type, category, subcategory, tags,
        lastmod, embedding, token_count, crawled_at,
        canonical_url, image_count, images_no_alt)
     VALUES ($1,$2,$3,$4,$5, $6,$7,$8,$9,$10, $11,$12::vector,$13, now(), $14,$15,$16)
     ON CONFLICT (url) DO UPDATE SET
       title = EXCLUDED.title,
       meta_description = EXCLUDED.meta_description,
       h1 = EXCLUDED.h1,
       content_text = EXCLUDED.content_text,
       content_type = EXCLUDED.content_type,
       course_type = EXCLUDED.course_type,
       category = EXCLUDED.category,
       subcategory = EXCLUDED.subcategory,
       tags = EXCLUDED.tags,
       lastmod = EXCLUDED.lastmod,
       embedding = EXCLUDED.embedding,
       token_count = EXCLUDED.token_count,
       crawled_at = now(),
       canonical_url = EXCLUDED.canonical_url,
       image_count = EXCLUDED.image_count,
       images_no_alt = EXCLUDED.images_no_alt`,
    [
      entry.url,
      page.title,
      page.metaDescription,
      page.h1,
      page.contentText.slice(0, 20000),
      tagged.contentType,
      tagged.courseType,
      tagged.category,
      tagged.subcategory,
      tagged.tags,
      entry.lastmod ?? null,
      toVectorLiteral(embedding),
      estimateTokens(page.contentText),
      page.canonicalUrl,
      page.imageCount,
      page.imagesNoAlt,
    ],
  );
  return "done";
}

/**
 * Drive a worker pool over a queue of sitemap entries. Returns the rollup
 * counters. Concurrency defaults to 10 — same as audit-links.
 */
export async function runIngestPool(
  entries: SitemapEntry[],
  deps: IngestDeps,
  opts: {
    concurrency?: number;
    checkExistingEmbedding?: boolean;
    onError?: (url: string, err: Error) => void;
  } = {},
): Promise<{ done: number; skipped: number; failed: number }> {
  const concurrency = opts.concurrency ?? 10;
  let cursor = 0;
  let done = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (cursor < entries.length) {
      const i = cursor++;
      const entry = entries[i];
      if (!entry) continue;
      try {
        const outcome = await ingestOne(entry, deps, {
          checkExistingEmbedding: opts.checkExistingEmbedding,
        });
        if (outcome === "done") done++;
        else if (outcome === "skipped") skipped++;
        else failed++;
      } catch (e) {
        failed++;
        opts.onError?.(entry.url, e as Error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { done, skipped, failed };
}
