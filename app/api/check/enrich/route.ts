import { NextRequest, NextResponse } from "next/server";
import { pageStatsBatch, queryStats } from "@/lib/gsc-page-stats";
import { serpOverlap } from "@/lib/competitors-extra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * POST /api/check/enrich
 * Body: { urls: string[], topic?: string, withSerp?: boolean }
 *
 * For each match URL: 6m + 12m GSC stats + top-3 ranking keywords.
 * If `topic` and `withSerp`, also returns competitor SERP refs + keyword gap
 * (queries competitors rank for that we don't).
 *
 * Best-effort — GSC and Serper failures are returned as empty rather than 500
 * so a slow Conflict Checker render doesn't fail the whole page.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const urls: string[] = Array.isArray(body.urls) ? body.urls.slice(0, 10) : [];
    const topic = (body.topic ?? "").toString().trim();
    const withSerp = body.withSerp !== false;
    if (!urls.length) {
      return NextResponse.json({ error: "Missing 'urls[]'." }, { status: 400 });
    }

    // 1. GSC stats per URL (sequential — quota-friendly).
    let stats: any[] = [];
    try { stats = await pageStatsBatch(urls, 3) }
    catch (e) {
      // Surface a soft warning instead of 500.
      return NextResponse.json({
        gscError: (e as Error).message,
        stats: urls.map((u) => ({ url: u, m6: empty(), m12: empty(), topQueries: [] })),
        serp: null, gap: [],
      });
    }

    // 2. SERP overlap for the topic (one Serper call) — gives us competitor refs.
    //    Also pulls Edstellar's own GSC rank for that exact keyword so we can
    //    show our current position vs the competitors in the SERP table.
    let serp: any = null;
    let ourRank: any = null;
    let gap: string[] = [];
    if (withSerp && topic) {
      try {
        const [serpRes, qStats] = await Promise.all([
          serpOverlap(topic),
          queryStats(topic, 1).catch(() => null),
        ]);
        serp = serpRes;
        if (qStats) {
          ourRank = {
            query: qStats.query,
            position6m:  qStats.m6.position,
            clicks6m:    qStats.m6.clicks,
            impressions6m: qStats.m6.impressions,
            position12m: qStats.m12.position,
            clicks12m:   qStats.m12.clicks,
            impressions12m: qStats.m12.impressions,
            topPage: qStats.topPages?.[0] ?? null,
          };
        }
        // Keyword gap: queries our existing pages rank for (from topQueries)
        //   vs keywords mentioned in the SERP titles. Very rough but useful.
        const ourQueries = new Set(
          stats.flatMap((s) => s.topQueries.map((q: any) => q.query.toLowerCase())),
        );
        const titleTokens = serp.organic
          .filter((r: any) => !r.isEdstellar)
          .flatMap((r: any) =>
            (r.title || "").toLowerCase()
              .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
              .filter((w: string) => w.length > 3 && !STOP.has(w)),
          );
        const tally = new Map<string, number>();
        for (const t of titleTokens) tally.set(t, (tally.get(t) ?? 0) + 1);
        gap = [...tally.entries()]
          .filter(([w, n]) => n >= 2 && !ourQueries.has(w))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([w]) => w);
      } catch (e) {
        serp = { error: (e as Error).message };
      }
    }

    return NextResponse.json({ stats, serp, gap, ourRank });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const STOP = new Set([
  "the","and","for","with","from","that","this","your","you","are","best","top","how",
  "what","why","into","over","under","about","when","more","than","training","course",
  "courses","program","programs","2024","2025","2026","guide","tips","help",
]);

function empty() { return { clicks: 0, impressions: 0, ctr: 0, position: 0 } }
