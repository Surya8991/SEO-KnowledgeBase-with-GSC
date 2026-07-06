/**
 * Weekly cron — only re-fetch URLs whose sitemap lastmod changed since the
 * last crawl. Intended for Vercel Cron (see vercel.json).
 *
 * Audit H10 (Session 6): the prior implementation ran a serial for-loop
 * over the entire sitemap inside a single 300s function — guaranteed to
 * timeout once the sitemap grew past ~600 URLs. Now uses the shared
 * runIngestPool() worker pool with concurrency=10, mirroring audit-links.
 */
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { readSitemapCsv } from "@/lib/sitemap";
import { getEmbedder } from "@/lib/ai";
import { runIngestPool } from "@/lib/ingest-page";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 10;

export async function GET(request: NextRequest) {
  const unauth = requireCronAuth(request);
  if (unauth) return unauth;

  const sql = neon(process.env.DATABASE_URL!);
  const embedder = getEmbedder();
  const entries = readSitemapCsv();

  const { done, skipped, failed } = await runIngestPool(
    entries,
    { sql, embedder },
    {
      concurrency: CONCURRENCY,
      onError: (url, err) => {
        console.warn(`[reingest] ${url}: ${err.message}`);
      },
    },
  );

  // #10 — return 5xx if too many rows failed so Vercel's cron dashboard
  // shows the job as failed and the team sees it. Threshold: more than 25%
  // of attempted (done+failed) rows. 'skipped' isn't a failure.
  const attempted = done + failed;
  const failureRate = attempted > 0 ? failed / attempted : 0;
  const status = failureRate > 0.25 ? 500 : 200;
  return NextResponse.json(
    { done, skipped, failed, failureRate: Number(failureRate.toFixed(3)) },
    { status },
  );
}
