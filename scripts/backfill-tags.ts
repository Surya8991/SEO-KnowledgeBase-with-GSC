/**
 * Retag every existing `pages` row using lib/taxonomy.
 * Pure metadata UPDATE — no re-fetch, no re-embed. Idempotent.
 * Run: npm run backfill:tags
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { tagUrl } from "@/lib/taxonomy";

interface Row {
  id: number;
  url: string;
  title: string | null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = neon(url);

  const rows = (await sql.query(
    "SELECT id, url, title FROM pages ORDER BY id",
  )) as Row[];

  console.log(`Retagging ${rows.length} pages…`);
  const counts: Record<string, number> = {};
  let updated = 0;

  for (const row of rows) {
    const t = tagUrl(row.url, row.title);
    counts[t.contentType] = (counts[t.contentType] ?? 0) + 1;
    await sql.query(
      `UPDATE pages
         SET content_type = $1,
             course_type  = $2,
             category     = $3,
             subcategory  = $4,
             tags         = $5
       WHERE id = $6`,
      [t.contentType, t.courseType, t.category, t.subcategory, t.tags, row.id],
    );
    updated++;
    if (updated % 200 === 0) {
      process.stdout.write(`  ${updated}/${rows.length}\n`);
    }
  }

  console.log(`\n✓ Retagged ${updated} pages.`);
  console.log("Breakdown by content_type:");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${v}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
