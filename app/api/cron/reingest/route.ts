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
import { log } from "@/lib/logger";

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

  // Session 11 audit (no resume cursor): this function has a 300s ceiling and
  // no checkpoint, so a corpus that doesn't finish in one run used to restart
  // from URL 0 — re-checking already-fresh pages before reaching the backlog.
  // Pre-filter to ONLY the URLs that actually need (re)ingest (missing row, or
  // sitemap lastmod changed / unknown), so every run spends its whole budget
  // on the unreached tail and the corpus converges across a few runs.
  const fresh = new Map<string, string | null>();
  try {
    const rows = (await sql.query(
      "SELECT url, lastmod FROM pages WHERE embedding IS NOT NULL",
    )) as { url: string; lastmod: string | null }[];
    for (const r of rows) fresh.set(r.url, r.lastmod);
  } catch (e) {
    // If the pre-scan fails, fall back to processing everything (ingestOne
    // still skips unchanged rows individually).
    log.warn("reingest: fresh-set prescan failed; processing full sitemap", {
      error: (e as Error).message,
    });
  }
  const work = entries.filter((entry) => {
    if (!fresh.has(entry.url)) return true; // never ingested
    const storedLastmod = fresh.get(entry.url) ?? null;
    // Re-ingest when the sitemap advertises a lastmod that differs from (or is
    // newer than) what we stored; skip when they match.
    return !entry.lastmod || entry.lastmod !== storedLastmod;
  });
  const skippedFresh = entries.length - work.length;

  // Stop pulling new work ~30s before the 300s ceiling so the function drains
  // in-flight pages and returns real partial counts instead of being killed.
  const deadlineMs = Date.now() + (maxDuration - 30) * 1000;
  const { done, skipped, failed, stopped } = await runIngestPool(
    work,
    { sql, embedder },
    {
      concurrency: CONCURRENCY,
      deadlineMs,
      onError: (url, err) => {
        log.warn("reingest: page failed", { url, error: err.message });
      },
    },
  );

  const remaining = work.length - done - skipped - failed;
  log.info("reingest run complete", {
    total: entries.length,
    skippedFresh,
    done,
    skipped,
    failed,
    remaining,
    stopped,
  });

  // #10 — return 5xx if too many rows failed so Vercel's cron dashboard
  // shows the job as failed and the team sees it. Threshold: more than 25%
  // of attempted (done+failed) rows. 'skipped' isn't a failure.
  const attempted = done + failed;
  const failureRate = attempted > 0 ? failed / attempted : 0;
  const status = failureRate > 0.25 ? 500 : 200;
  return NextResponse.json(
    {
      total: entries.length,
      skippedFresh,
      done,
      skipped,
      failed,
      // stopped=true (remaining>0) means the time budget was exhausted before
      // the backlog cleared; the next scheduled run resumes from here
      // (work-first prefilter re-scans and skips what's already fresh).
      remaining,
      stopped,
      failureRate: Number(failureRate.toFixed(3)),
    },
    { status },
  );
}
