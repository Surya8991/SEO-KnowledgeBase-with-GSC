import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { google } from "googleapis";
import { getAuthorizedClient, resolveSiteUrl } from "@/lib/gsc";
import { log } from "@/lib/logger";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily cron — three jobs in one:
 *   1. Snapshot yesterday's totals + branded vs non-branded into
 *      gsc_daily_totals (the legacy job).
 *   2. Sync per-page last-28-day clicks/impressions/position onto the
 *      pages row (powers business-impact severity scoring — #26).
 *   3. Mark pages stale: gsc_clicks_28d < 5 AND lastmod older than 12 months
 *      (powers the stale-content tab — #28).
 */
const STALE_LASTMOD_DAYS = 365;
const STALE_CLICKS_THRESHOLD = 5;

export async function GET(request: NextRequest) {
  const unauth = requireCronAuth(request);
  if (unauth) return unauth;
  try {
    const client = await getAuthorizedClient();
    if (!client) throw new Error("Not connected to GSC.");
    const siteUrl = await resolveSiteUrl(client);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    const twentyEightDaysAgo = new Date(today.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
    const webmasters = google.webmasters({ version: "v3", auth: client });

    // --- Job 1: daily snapshot (unchanged) ----------------------------------
    const byDate = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: yesterday, endDate: yesterday, dimensions: ["date"], rowLimit: 1 },
    });
    const day = (byDate.data.rows ?? [])[0];

    const byQuery = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: yesterday, endDate: yesterday, dimensions: ["query"], rowLimit: 1000 },
    });
    const brandTerms = (process.env.BRAND_TERMS || "edstellar")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    let bc = 0, bi = 0;
    for (const r of byQuery.data.rows ?? []) {
      const q = (r.keys?.[0] ?? "").toLowerCase();
      if (brandTerms.some((t) => q.includes(t))) {
        bc += r.clicks ?? 0; bi += r.impressions ?? 0;
      }
    }

    const sql = neon(process.env.DATABASE_URL!);
    await sql.query(
      `INSERT INTO gsc_daily_totals
         (site_url, date, clicks, impressions, ctr, position, branded_clicks, branded_impressions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (site_url, date) DO UPDATE SET
         clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions,
         ctr=EXCLUDED.ctr, position=EXCLUDED.position,
         branded_clicks=EXCLUDED.branded_clicks, branded_impressions=EXCLUDED.branded_impressions,
         fetched_at=now()`,
      [siteUrl, yesterday, day?.clicks ?? 0, day?.impressions ?? 0,
       day?.ctr ?? 0, day?.position ?? 0, bc, bi],
    );

    // --- Job 2: sync per-page 28d totals onto pages -------------------------
    // One pageful at a time (GSC caps at 25k rows per call).
    const byPage = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: twentyEightDaysAgo,
        endDate: yesterday,
        dimensions: ["page"],
        rowLimit: 25000,
      },
    });
    const rows = byPage.data.rows ?? [];

    // Batch UNNEST UPDATE — same pattern as audit-links.
    const urls: string[] = [];
    const clicks: number[] = [];
    const impressions: number[] = [];
    const positions: number[] = [];
    for (const r of rows) {
      const url = r.keys?.[0];
      if (!url) continue;
      urls.push(url);
      clicks.push(Math.round(r.clicks ?? 0));
      impressions.push(Math.round(r.impressions ?? 0));
      positions.push(Number((r.position ?? 0).toFixed(2)));
    }
    let pagesSynced = 0;
    if (urls.length) {
      const result = (await sql.query(
        `UPDATE pages
            SET gsc_clicks_28d      = data.clicks,
                gsc_impressions_28d = data.impressions,
                gsc_position_28d    = data.position,
                gsc_synced_at       = now()
           FROM (SELECT unnest($1::text[]) AS url,
                        unnest($2::int[])  AS clicks,
                        unnest($3::int[])  AS impressions,
                        unnest($4::real[]) AS position) AS data
          WHERE pages.url = data.url
          RETURNING pages.id`,
        [urls, clicks, impressions, positions],
      )) as any[];
      pagesSynced = result.length;
    }

    // --- Job 3: mark stale pages -------------------------------------------
    // Audit H7 (Session 6): formerly two UPDATEs — `SET is_stale=false`
    // unconditionally, then `SET is_stale=true WHERE <predicate>`. Between
    // them every page briefly flipped to is_stale=false, visible to any
    // concurrent reader. Replaced with one atomic UPDATE that sets the
    // flag from the predicate; pages that have RECOVERED unflag in the
    // same statement.
    const staleReason = `low traffic (<${STALE_CLICKS_THRESHOLD} clicks/28d) + lastmod > ${STALE_LASTMOD_DAYS}d`;
    const staleResult = (await sql.query(
      `UPDATE pages
          SET is_stale = (
                content_type IN ('blog','course','category','subcategory')
                AND gsc_clicks_28d IS NOT NULL
                AND gsc_clicks_28d < $1
                AND (lastmod IS NULL OR lastmod::date < (now() - make_interval(days => $2::int))::date)
              ),
              stale_reason = CASE
                WHEN content_type IN ('blog','course','category','subcategory')
                 AND gsc_clicks_28d IS NOT NULL
                 AND gsc_clicks_28d < $1
                 AND (lastmod IS NULL OR lastmod::date < (now() - make_interval(days => $2::int))::date)
                  THEN $3
                ELSE NULL
              END
        WHERE is_stale IS DISTINCT FROM (
                content_type IN ('blog','course','category','subcategory')
                AND gsc_clicks_28d IS NOT NULL
                AND gsc_clicks_28d < $1
                AND (lastmod IS NULL OR lastmod::date < (now() - make_interval(days => $2::int))::date)
              )
        RETURNING id, is_stale`,
      [STALE_CLICKS_THRESHOLD, STALE_LASTMOD_DAYS, staleReason],
    )) as { id: number; is_stale: boolean }[];
    const staleCount = staleResult.filter((r) => r.is_stale).length;

    log.info("gsc snapshot complete", {
      date: yesterday,
      clicks: day?.clicks ?? 0,
      pages_synced: pagesSynced,
      stale_count: staleCount,
    });
    return NextResponse.json({
      date: yesterday,
      clicks: day?.clicks ?? 0,
      branded_clicks: bc,
      pages_synced: pagesSynced,
      stale_count: staleCount,
    });
  } catch (e) {
    log.error("gsc snapshot failed", { error: (e as Error).message });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
