/**
 * Quick post-ingest sanity report:
 *   - Total page count + content_type breakdown
 *   - Junk URLs still in corpus (should be 0 after cleanup-junk-pages + re-ingest)
 *   - 3 random blog rows: title + first 300 chars of content_text
 *     (eyeball for leftover nav/footer/related/share noise)
 *
 * Usage:  tsx scripts/verify-corpus.ts
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { isJunkUrl } from "@/lib/sitemap";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const total = (await sql.query("SELECT count(*)::int AS n FROM pages")) as { n: number }[];
  console.log("Total pages:", total[0].n);

  const byType = (await sql.query(
    "SELECT content_type, count(*)::int AS n FROM pages GROUP BY content_type ORDER BY n DESC",
  )) as { content_type: string | null; n: number }[];
  console.log("\nBy content_type:");
  byType.forEach((r) => console.log(`  ${(r.content_type ?? "(null)").padEnd(15)} ${r.n}`));

  const all = (await sql.query("SELECT id, url FROM pages")) as { id: number; url: string }[];
  const junk = all.filter((r) => isJunkUrl(r.url));
  console.log(`\nJunk URLs still in corpus (should be 0): ${junk.length}`);
  if (junk.length) junk.slice(0, 10).forEach((r) => console.log(`  ${r.url}`));

  console.log("\n--- Spot check: first 300 chars of content_text on 3 random blogs ---");
  const blogs = (await sql.query(
    "SELECT url, title, left(content_text, 300) AS snippet FROM pages WHERE content_type='blog' ORDER BY random() LIMIT 3",
  )) as { url: string; title: string; snippet: string }[];
  blogs.forEach((b) => {
    console.log(`\n[${b.url}]`);
    console.log(`Title: ${b.title}`);
    console.log(`Snippet: ${b.snippet}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
