import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { readSitemapCsv } from "@/lib/sitemap";
import { fetchAndExtract, estimateTokens } from "@/lib/extract";
import { tagUrl } from "@/lib/taxonomy";
import { getEmbedder } from "@/lib/ai";
import { toVectorLiteral } from "@/lib/search";

interface Args {
  limit?: number;
  only?: string;
  force?: boolean;
  concurrency: number;
}

function parseArgs(): Args {
  const a: Args = { concurrency: 4 };
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "limit") a.limit = Number(v);
    else if (k === "only") a.only = v;
    else if (k === "force") a.force = true;
    else if (k === "concurrency") a.concurrency = Number(v);
  }
  return a;
}

async function main() {
  const args = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = neon(url);
  const embedder = getEmbedder();

  let entries = readSitemapCsv();
  if (args.only)
    entries = entries.filter((e) => tagUrl(e.url).contentType === args.only);
  if (args.limit) entries = entries.slice(0, args.limit);

  console.log(
    `Ingesting ${entries.length} URLs · embedder=${embedder.name} · concurrency=${args.concurrency}`,
  );

  let done = 0;
  let skipped = 0;
  let failed = 0;

  // Simple worker pool over the entry list.
  const queue = [...entries];
  async function worker(id: number) {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) break;
      try {
        if (!args.force) {
          const existing = (await sql.query(
            "SELECT lastmod, embedding IS NOT NULL AS has_emb FROM pages WHERE url = $1",
            [entry.url],
          )) as any[];
          if (
            existing[0]?.has_emb &&
            entry.lastmod &&
            existing[0]?.lastmod === entry.lastmod
          ) {
            skipped++;
            continue;
          }
        }

        const page = await fetchAndExtract(entry.url);
        const text = [page.title, page.h1, page.contentText]
          .filter(Boolean)
          .join("\n")
          .slice(0, 12000);
        if (!text.trim()) {
          failed++;
          continue;
        }
        const [embedding] = await embedder.embed([text]);
        const vec = toVectorLiteral(embedding);
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
            entry.lastmod,
            vec,
            estimateTokens(page.contentText),
            page.canonicalUrl,
            page.imageCount,
            page.imagesNoAlt,
          ],
        );
        done++;
        if ((done + skipped + failed) % 25 === 0) {
          console.log(
            `  [w${id}] progress: ${done} done, ${skipped} skipped, ${failed} failed, ${queue.length} left`,
          );
        }
      } catch (e: any) {
        failed++;
        console.warn(`  ✗ ${entry.url}: ${e.message}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, args.concurrency) }, (_, i) => worker(i + 1)),
  );

  console.log(`\n✓ Ingest complete: ${done} embedded, ${skipped} skipped, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
