/**
 * Lightweight inbound-link counter.
 *
 * Audit 10C polish (Session 9): the audit recommended a proper
 * inbound-links table that the ingest pipeline populates as it crawls.
 * That's a multi-hour project (new table, schema migration, ingest
 * rewrite, UI). This module does the same job by querying:
 *
 *   "how many other pages' content_text mentions this URL?"
 *
 * Pros vs the proper approach:
 *   - Zero schema change. Works against the data already in `pages`.
 *   - Always up-to-date with the latest crawl.
 * Cons:
 *   - O(N) full-table scan per query — uses a LIKE pattern, not an
 *     indexed lookup. Acceptable at ~2,500 pages; revisit at 50k+.
 *   - Counts substring matches, not parsed `<a href>` — false-positives
 *     when a URL appears in copy text without being a real anchor.
 *     For SEO-internal-linking suggestions this is good enough; the
 *     downstream LLM still picks reasonable anchor variants.
 *
 * The result feeds /api/internal-links composite scoring: pages with
 * FEWER inbound links from the rest of the corpus get a small boost
 * (they need links more); pages already heavily linked get penalised
 * slightly (don't reinforce existing equity stacks).
 */
import { sql } from "drizzle-orm";
import { db, neonRows } from "@/lib/db";

interface InboundRow {
  url: string;
  inbound: number;
}

/**
 * Return an inbound-count map keyed by candidate URL. Pages whose URLs
 * appear as a substring in another page's content_text are counted.
 *
 * Excludes:
 *   - Self-references (a page mentioning its own URL).
 *   - The optional `excludeUrl` (typically the draft being analysed).
 */
export async function fetchInboundCounts(
  candidateUrls: string[],
  excludeUrl?: string,
): Promise<Record<string, number>> {
  if (candidateUrls.length === 0) return {};
  // Trim each URL to a "stable substring" we'll LIKE-match in content_text.
  // The full URL with the scheme is reliable. Strip trailing slashes so
  // /foo and /foo/ both match.
  const patterns = candidateUrls.map((u) => u.replace(/\/$/, ""));
  const exclude = excludeUrl ?? "";

  const rows = await db.execute(sql`
    SELECT t.url, count(p.id)::int AS inbound
    FROM unnest(${patterns}::text[]) AS t(url)
    LEFT JOIN pages p
      ON p.content_text ILIKE '%' || t.url || '%'
      AND p.url <> t.url
      AND p.url <> ${exclude}
    GROUP BY t.url
  `);

  const map: Record<string, number> = {};
  for (const r of neonRows<InboundRow>(rows)) {
    map[r.url] = Number(r.inbound) || 0;
  }
  // Ensure every requested URL has a key even when zero.
  for (const u of candidateUrls) {
    if (!(u in map)) map[u] = map[u.replace(/\/$/, "")] ?? 0;
  }
  return map;
}

/**
 * Convert an inbound-link count to a weight in [0.85, 1.15]:
 *   - 0 inlinks            → 1.15  (orphan, needs more links — boost)
 *   - 1-3                  → 1.05
 *   - 4-15                 → 1.00  (healthy — neutral)
 *   - 16+                  → 0.90  (already well-linked — slight penalty)
 *   - 50+                  → 0.85  (saturated — stronger penalty)
 *
 * Multiplied into the composite score so well-targeted links don't
 * pile onto pages that already have plenty.
 */
export function inboundWeight(inbound: number): number {
  if (inbound <= 0) return 1.15;
  if (inbound <= 3) return 1.05;
  if (inbound <= 15) return 1.0;
  if (inbound <= 49) return 0.9;
  return 0.85;
}
