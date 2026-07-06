import "dotenv/config";
import { neon } from "@neondatabase/serverless";

/**
 * Precompute near-duplicate page pairs across the whole corpus. For each page,
 * find its top-k neighbors by cosine similarity (pgvector) and store pairs
 * above a threshold. De-duplicates A↔B / B↔A by keeping a_id < b_id.
 *
 * Filters applied (each one motivated by a class of false-positive seen in
 * the v1 output the user flagged):
 *
 *   1. Static pages (forms, contact, about, terms) are excluded on BOTH sides.
 *      The old run flagged 'Enquire Now' ↔ 'Get a Free Demo' as 94% overlap,
 *      which is technically true (similar CTA copy) but isn't a content
 *      cannibalization the team can act on.
 *
 *   2. "Template-noise duplicates" — pairs with similarity ≥ 0.97 where one
 *      or both pages have less than 1.5KB of body text. These usually share
 *      a chrome-heavy template (nav + footer + a short CTA) and don't
 *      represent real overlap.
 *
 *   3. Pair-type taxonomy tightened:
 *      - 'duplicate'         sim ≥ 0.95, same content_type
 *      - 'cannibalization'   sim ≥ 0.85, same content_type (the dangerous one)
 *      - 'category-bleed'    category↔course/blog — category page too narrow
 *      - 'subcategory-bleed' subcategory↔course/blog
 *      - 'overlap'           everything else above threshold
 *
 *   4. Per-page neighbor cap raised from 3 → 5, but stricter threshold means
 *      most pages still emit 0-2 pairs.
 *
 * Flags: --threshold=0.85  --limit=N (cap pages scanned)  --min-body=1500
 */

const EXCLUDED_CONTENT_TYPES = new Set(["static"]);
const MIN_BODY_FOR_HIGH_SIM = 1500; // chars

interface Row {
  id: number;
  url: string;
  title: string | null;
  content_type: string | null;
  body_len: number;
}

interface Neighbor extends Row {
  similarity: number;
}

function pairType(
  sim: number,
  aType: string | null,
  bType: string | null,
): string {
  const same = aType && aType === bType;
  if (same && sim >= 0.95) return "duplicate";
  if (same && sim >= 0.85) return "cannibalization";
  if (aType === "category" || bType === "category") return "category-bleed";
  if (aType === "subcategory" || bType === "subcategory") return "subcategory-bleed";
  return "overlap";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = neon(url);

  let threshold = 0.85;
  let limit: number | null = null;
  let minBody = MIN_BODY_FOR_HIGH_SIM;
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "threshold") threshold = Number(v);
    if (k === "limit") limit = Number(v);
    if (k === "min-body") minBody = Number(v);
  }

  await sql.query("DELETE FROM catalog_conflicts");

  // Pull every embedded page once into memory along with the metadata we need
  // for filtering. Cheaper than re-querying for each neighbor.
  const pages = (await sql.query(
    `SELECT id, url, title, content_type, length(coalesce(content_text,'')) AS body_len
       FROM pages
      WHERE embedding IS NOT NULL
      ORDER BY id
      ${limit ? `LIMIT ${limit}` : ""}`,
  )) as Row[];
  const byId = new Map<number, Row>();
  for (const p of pages) byId.set(p.id, p);
  console.log(
    `Scanning ${pages.length} pages · threshold=${threshold} · min-body=${minBody}`,
  );

  let found = 0;
  let skippedStatic = 0;
  let skippedTemplateNoise = 0;
  const seen = new Set<string>();

  for (const a of pages) {
    if (EXCLUDED_CONTENT_TYPES.has(a.content_type ?? "")) {
      skippedStatic++;
      continue;
    }
    const neighbors = (await sql.query(
      `SELECT p2.id, 1 - (p1.embedding <=> p2.embedding) AS similarity
         FROM pages p1
         JOIN pages p2 ON p2.id <> p1.id AND p2.embedding IS NOT NULL
        WHERE p1.id = $1
        ORDER BY p1.embedding <=> p2.embedding
        LIMIT 5`,
      [a.id],
    )) as Neighbor[];

    for (const nRow of neighbors) {
      const sim = Number(nRow.similarity);
      if (sim < threshold) continue;
      const b = byId.get(nRow.id);
      if (!b) continue;

      // Filter 1: exclude static pages on either side.
      if (EXCLUDED_CONTENT_TYPES.has(b.content_type ?? "")) continue;

      // De-dup A↔B / B↔A.
      const lo = Math.min(a.id, b.id);
      const hi = Math.max(a.id, b.id);
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Filter 2: template-noise high-similarity pairs.
      if (sim >= 0.97 && (a.body_len < minBody || b.body_len < minBody)) {
        skippedTemplateNoise++;
        continue;
      }

      const pt = pairType(sim, a.content_type, b.content_type);

      await sql.query(
        `INSERT INTO catalog_conflicts
           (a_id, a_url, a_title, a_type, b_id, b_url, b_title, b_type, similarity, pair_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.id, a.url, a.title, a.content_type, b.id, b.url, b.title, b.content_type, sim, pt],
      );
      found++;
    }
  }

  console.log(`\n✓ Stored ${found} conflicting pairs.`);
  console.log(`  Skipped (static): ${skippedStatic}`);
  console.log(`  Skipped (template-noise high-sim): ${skippedTemplateNoise}`);

  const breakdown = (await sql.query(
    "SELECT pair_type, count(*)::int AS n FROM catalog_conflicts GROUP BY pair_type ORDER BY n DESC",
  )) as { pair_type: string; n: number }[];
  console.log("\nBy pair_type:");
  breakdown.forEach((r) => console.log(`  ${r.pair_type.padEnd(22)} ${r.n}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
