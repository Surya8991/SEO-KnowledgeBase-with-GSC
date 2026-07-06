/**
 * One-off: reclassify the homepage row from content_type='home' to 'static'.
 * The 'home' tag is preserved so it's still distinguishable in tag filters.
 * Idempotent — re-running after the row is fixed is a no-op.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { assertProdWritesAllowed } from "@/lib/db/prod-guard";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const before = (await sql.query(
    "SELECT id, url, content_type, tags FROM pages WHERE content_type = 'home'",
  )) as any[];
  console.log("Before:", before);
  if (!before.length) return console.log("No rows to migrate.");

  // H5: block accidental UPDATE against the shared production DB.
  assertProdWritesAllowed("reclassify 'home' pages to 'static'");

  const after = (await sql.query(
    `UPDATE pages
       SET content_type = 'static',
           tags = (
             SELECT array_agg(DISTINCT t)
             FROM unnest(coalesce(tags, ARRAY[]::text[]) || ARRAY['home']::text[]) t
           )
     WHERE content_type = 'home'
     RETURNING id, url, content_type, tags`,
  )) as any[];
  console.log("After:", after);
}

main().catch((e) => { console.error(e); process.exit(1); });
