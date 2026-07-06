/**
 * One-off cleanup: preview + delete rows in `pages` that the new
 * lib/sitemap.ts isJunkUrl() filter would reject.
 *
 * Usage:
 *   tsx scripts/cleanup-junk-pages.ts            # preview only (default)
 *   tsx scripts/cleanup-junk-pages.ts --delete   # actually delete
 *
 * Run AFTER deploying the commit that adds isJunkUrl(), and BEFORE the
 * next `npm run ingest -- --force` so the re-ingest doesn't re-create
 * what we just removed.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { isJunkUrl } from "@/lib/sitemap";

async function main() {
  const doDelete = process.argv.includes("--delete");
  const sql = neon(process.env.DATABASE_URL!);

  const rows = (await sql.query(
    `SELECT id, url, content_type FROM pages ORDER BY url`,
  )) as { id: number; url: string; content_type: string | null }[];

  const junk = rows.filter((r) => isJunkUrl(r.url));

  console.log(`Total pages: ${rows.length}`);
  console.log(`Junk pages: ${junk.length}`);

  const byType: Record<string, number> = {};
  for (const r of junk) {
    const t = r.content_type || "(null)";
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log("\nBreakdown by content_type:");
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(12)} ${n}`);
  }

  console.log("\nSample (first 20):");
  for (const r of junk.slice(0, 20)) {
    console.log(`  [${r.content_type ?? "?"}] ${r.url}`);
  }

  if (!doDelete) {
    console.log("\nDry run. Re-run with --delete to remove these rows.");
    return;
  }

  if (junk.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  const ids = junk.map((r) => r.id);
  // Delete in chunks to avoid bind-param limits on big lists.
  let removed = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    await sql.query(`DELETE FROM check_matches WHERE page_url IN (
      SELECT url FROM pages WHERE id = ANY($1::int[])
    )`, [slice]);
    const r = (await sql.query(
      `DELETE FROM pages WHERE id = ANY($1::int[]) RETURNING id`,
      [slice],
    )) as { id: number }[];
    removed += r.length;
  }
  console.log(`\n✓ Deleted ${removed} junk rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
