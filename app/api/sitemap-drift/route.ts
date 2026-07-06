import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import * as cheerio from "cheerio";
import { isJunkUrl } from "@/lib/sitemap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/sitemap-drift?host=https://www.edstellar.com
 *
 * Fetches the live sitemap.xml, diffs against pages.url in the corpus, and
 * returns:
 *   - publishedNotIngested: URLs in live sitemap but missing from pages
 *                            (i.e. the team published things and the
 *                            ingest cron hasn't picked them up yet)
 *   - removedFromSitemap:   URLs in pages but not in the live sitemap
 *                            (i.e. unpublished/404 but still scoring as
 *                            conflicts)
 *
 * Both lists are filtered through the same junk-URL pattern the sitemap
 * loader uses so noise (tag archives, file downloads) doesn't show up as
 * 'drift'.
 *
 * Cheap to run — one fetch + one DB query. No cron needed; it's a snapshot
 * computed on demand from the dashboard.
 */

async function fetchSitemapUrls(rootHost: string): Promise<string[]> {
  // Edstellar uses one sitemap index → fetch + recurse one level deep.
  const out = new Set<string>();
  const root = rootHost.replace(/\/+$/, "") + "/sitemap.xml";
  const visit = async (sm: string): Promise<void> => {
    const res = await fetch(sm, { headers: { accept: "application/xml,text/xml" } });
    if (!res.ok) return;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const subs = $("sitemap > loc").map((_, el) => $(el).text().trim()).get();
    if (subs.length) {
      // sitemap index — recurse.
      await Promise.all(subs.slice(0, 50).map(visit));
      return;
    }
    $("url > loc").each((_, el) => {
      const u = $(el).text().trim();
      if (u) out.add(u);
    });
  };
  await visit(root);
  return [...out];
}

export async function GET(request: Request) {
  try {
    const u = new URL(request.url);
    const host = u.searchParams.get("host") || "https://www.edstellar.com";
    const live = (await fetchSitemapUrls(host)).filter((url) => !isJunkUrl(url));
    const liveSet = new Set(live);

    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql.query(
      "SELECT url FROM pages",
    )) as { url: string }[];
    const corpusSet = new Set(rows.map((r) => r.url));

    const publishedNotIngested = live
      .filter((url) => !corpusSet.has(url))
      .slice(0, 500);
    const removedFromSitemap = rows
      .map((r) => r.url)
      .filter((url) => !liveSet.has(url) && !isJunkUrl(url))
      .slice(0, 500);

    return NextResponse.json({
      liveCount: live.length,
      corpusCount: rows.length,
      publishedNotIngested,
      removedFromSitemap,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
