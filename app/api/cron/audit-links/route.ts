import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Weekly cron — HEAD-check every URL, write http_status.
 *
 * Optimised vs the v1 implementation:
 *   - HEAD requests are issued with concurrency=10 instead of sequentially
 *     (was the dominant cost — 1500 URLs × ~300ms each = 7.5 min serial).
 *   - DB writes batched into a single UNNEST UPDATE per 200 rows instead of
 *     1500 individual UPDATEs. Saves ~1500 round-trips → 8 → fits comfortably
 *     under the 300s function timeout from cold.
 */
const PROBE_CONCURRENCY = 10;
const WRITE_BATCH = 200;

async function probe(url: string): Promise<number> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15_000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: c.signal, redirect: "follow" });
    let status = res.status;
    if (status === 405 || status === 501) {
      const r2 = await fetch(url, { method: "GET", signal: c.signal, redirect: "follow" });
      status = r2.status;
    }
    return status;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request: NextRequest) {
  const unauth = requireCronAuth(request);
  if (unauth) return unauth;
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql.query(
    "SELECT id, url FROM pages ORDER BY last_audited_at NULLS FIRST LIMIT 1500",
  )) as { id: number; url: string }[];

  let broken = 0;
  const results: { id: number; status: number }[] = [];

  // Concurrent worker pool — probe URLs in parallel.
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const i = cursor++;
      const r = rows[i]!;
      const status = await probe(r.url);
      if (!status || status >= 400) broken++;
      results.push({ id: r.id, status });
    }
  }
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));

  // Batched UNNEST UPDATEs.
  for (let i = 0; i < results.length; i += WRITE_BATCH) {
    const slice = results.slice(i, i + WRITE_BATCH);
    const ids = slice.map((r) => r.id);
    const statuses = slice.map((r) => r.status || null);
    await sql.query(
      `UPDATE pages
          SET http_status = data.status,
              last_audited_at = now()
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS status) AS data
        WHERE pages.id = data.id`,
      [ids, statuses],
    );
  }

  // #10 — fail the cron when 'broken' (status=0 OR >=400) is more than 30%
  // of the rows checked. Some 4xx is expected in a sitemap; a sudden spike
  // is the signal we want visible on the Vercel cron dashboard.
  const checked = rows.length;
  const brokenRate = checked > 0 ? broken / checked : 0;
  const status = brokenRate > 0.30 ? 500 : 200;
  return NextResponse.json({ checked, broken, brokenRate: Number(brokenRate.toFixed(3)) }, { status });
}
