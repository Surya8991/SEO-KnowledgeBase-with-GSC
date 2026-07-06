import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import * as cheerio from "cheerio";
import { isJunkUrl } from "@/lib/sitemap";
import { safeFetch } from "@/lib/safe-fetch";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

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
    // C1: `sm` derives from the user-supplied host and from sitemap-index
    // <loc> values — guard every hop against SSRF. A blocked/unreachable
    // sub-sitemap is skipped, not fatal to the whole crawl.
    let xml: string;
    try {
      const { res } = await safeFetch(sm, {
        timeoutMs: 15_000,
        headers: { accept: "application/xml,text/xml" },
      });
      if (!res.ok) return;
      xml = await res.text();
    } catch {
      return;
    }
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

export async function GET(request: NextRequest) {
  // H1/H3: rate-limit (or require WEBHOOK_API_KEY) — this endpoint fans out
  // to remote fetches and a full-table scan, so it must not be open+unbounded.
  const gate = await gateLlmEndpoint(request, "sitemap-drift", { max: 20, windowSec: 60 });
  if (gate) return gate;
  try {
    const u = new URL(request.url);
    const host = u.searchParams.get("host") || "https://www.edstellar.com";
    // Reject non-absolute / non-http(s) hosts up front; the per-hop SSRF guard
    // in safeFetch still enforces the private-range block during the crawl.
    let parsedHost: URL;
    try {
      parsedHost = new URL(host);
    } catch {
      return NextResponse.json({ error: "Invalid 'host' — must be an absolute URL." }, { status: 400 });
    }
    if (parsedHost.protocol !== "http:" && parsedHost.protocol !== "https:") {
      return NextResponse.json({ error: "Invalid 'host' — only http/https." }, { status: 400 });
    }
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
    return errorResponse("/api/sitemap-drift", e, {
      status: 500,
      publicMessage: "Request failed.",
    });
  }
}
