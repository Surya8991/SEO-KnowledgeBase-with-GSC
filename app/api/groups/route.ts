import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { neonRows } from "@/lib/db";
import { clusterByTopic, type ClusterPage } from "@/lib/cluster";
import { SERIES } from "@/lib/series";
import { classifyIntent, type Intent } from "@/lib/intent";
import { pageAuthority, pickWinner, groupAction, type AuthorityInput } from "@/lib/resolution";
import { THRESHOLDS } from "@/lib/thresholds";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/groups — Content Clusters: group the WHOLE corpus by TOPIC
 * (PROJECTLOG §17, replacing the body-embedding connected-components approach
 * that chained different topics into one mega-cluster).
 *
 * Pipeline:
 *  1. Load every LIVE embedded page's title/H1/URL/type. Pages that redirect or
 *     are canonicalized elsewhere (scripts/detect-redirects.ts) are excluded.
 *  2. Center-based topic clustering (lib/cluster.clusterByTopic): each page
 *     joins the best-scoring pillar-priority seed by IDF-weighted distinctive-
 *     token overlap. NO ANN top-k, NO transitive chaining, NO type filter — a
 *     category, its blog, and its courses cluster together across types.
 *  3. Body floor: one batched cosine query over the (seed, member) pairs the
 *     clustering produced; members below CONFLICT_TOPIC_BODY_FLOOR vs their seed
 *     are demoted to unique-topic singletons.
 *  4. Per-cluster topic label + suggested action (pillar for hub+spokes) +
 *     winner + per-member shared topic tokens ("why grouped").
 *
 * Query: ?overlap (topic-overlap bar) ?minSize ?limit ?fresh.
 * Gated with gateLlmEndpoint: this runs a whole-corpus scan + batched cosine,
 * so it is rate-limited / key-gated rather than relying on the proxy session
 * gate (a no-op when AUTH_ENABLED=false).
 */
interface PageRow {
  url: string;
  title: string | null;
  h1: string | null;
  content_type: string | null;
  token_count: number | null;
}
interface SimRow {
  seed_url: string;
  member_url: string;
  sim: number;
}

/** Live-page predicate: not stale, canonical absent or self. */
const LIVE = (alias: string) =>
  `COALESCE(${alias}.is_stale, false) = false
   AND (${alias}.canonical_url IS NULL
        OR rtrim(${alias}.canonical_url, '/') = rtrim(${alias}.url, '/'))`;

const bkey = (seed: string, member: string) => `${seed} ${member}`;

/** Max singleton (unique-topic) pages returned for the browsable list. */
const SINGLETON_CAP = 500;

/**
 * Per-instance response cache. The full scan is 15-40s (whole-corpus fetch +
 * batched cosine) and the corpus changes rarely, so repeat visits within the
 * TTL return instantly. The Rescan button bypasses it with ?fresh=1.
 */
let groupsCache: { key: string; at: number; body: Record<string, unknown> } | null = null;
const GROUPS_CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const gate = await gateLlmEndpoint(request, "groups", { max: 15, windowSec: 60 });
  if (gate) return gate;
  try {
    const p = new URL(request.url).searchParams;
    const t = THRESHOLDS;
    const overrideOverlap = Number(p.get("overlap"));
    const overlap =
      Number.isFinite(overrideOverlap) && overrideOverlap > 0
        ? clamp(overrideOverlap, 0.1, 0.95)
        : t.topicOverlap;
    const overrideFloor = Number(p.get("floor"));
    const floor =
      Number.isFinite(overrideFloor) && overrideFloor > 0
        ? clamp(overrideFloor, 0.3, 0.95)
        : t.topicBodyFloor;
    const minSize = Math.max(2, Number(p.get("minSize")) || 2);
    const limit = clamp(Number(p.get("limit")) || 100, 1, 500);

    const cacheKey = `${overlap}|${floor}|${minSize}|${limit}`;
    if (
      !p.get("fresh") &&
      groupsCache &&
      groupsCache.key === cacheKey &&
      Date.now() - groupsCache.at < GROUPS_CACHE_TTL
    ) {
      return NextResponse.json({ ...groupsCache.body, cached: true });
    }

    const client = neon(process.env.DATABASE_URL || "postgresql://user:password@localhost/db");

    // 1. Every live embedded page. Topic keying needs title/H1/URL; the body
    //    floor needs the embedding (so we require it here too).
    const rows = neonRows<PageRow>(
      await client.query(
        `SELECT url, title, h1, content_type, token_count
         FROM pages p
         WHERE embedding IS NOT NULL AND ${LIVE("p")}`,
      ),
    );
    const corpusSize = rows.length;
    const meta = new Map(rows.map((r) => [r.url, r]));
    const pages: ClusterPage[] = rows.map((r) => ({
      url: r.url,
      title: r.title,
      h1: r.h1,
      type: r.content_type,
      tokenCount: r.token_count,
    }));

    // 2. First pass: topic clusters + programmatic blog series (body floor not
    //    yet applied). Series pages are grouped by slug template, not topic.
    const pass1 = clusterByTopic(pages, { overlap, minSize: 2, series: SERIES }, t);

    // 3. Body cosine for every (seed, member) pair — one batched query. Uses the
    //    raw neon client with positional $1::text[] params (drizzle's sql`` would
    //    mis-expand a JS array — AGENTS.md gotcha). Series clusters are excluded:
    //    they belong by slug template and never face the body floor.
    const seedUrls: string[] = [];
    const memberUrls: string[] = [];
    for (const c of pass1.clusters) {
      if (c.isSeries) continue;
      for (const m of c.members) {
        if (m.url === c.seedUrl) continue;
        seedUrls.push(c.seedUrl);
        memberUrls.push(m.url);
      }
    }
    const bodyMap = new Map<string, number>();
    if (seedUrls.length) {
      const sims = neonRows<SimRow>(
        await client.query(
          `SELECT s.url seed_url, m.url member_url, 1 - (s.embedding <=> m.embedding) sim
           FROM unnest($1::text[], $2::text[]) AS pair(seed_url, member_url)
           JOIN pages s ON s.url = pair.seed_url
           JOIN pages m ON m.url = pair.member_url
           WHERE s.embedding IS NOT NULL AND m.embedding IS NOT NULL`,
          [seedUrls, memberUrls],
        ),
      );
      for (const r of sims) bodyMap.set(bkey(r.seed_url, r.member_url), Number(r.sim));
    }

    // 4. Apply the body floor: demote members below it (vs their seed) to
    //    singletons; a cluster that drops under minSize dissolves entirely.
    let groupedPages = 0;
    const singletonUrls: string[] = [...pass1.singletons];

    const groups = pass1.clusters
      .map((c) => {
        const kept = c.members.filter((m) => {
          if (m.url === c.seedUrl) return true;
          const bs = bodyMap.get(bkey(c.seedUrl, m.url));
          return bs == null || bs >= floor; // no data → keep (can't disprove)
        });
        const demotedMembers = c.members.filter((m) => !kept.includes(m));
        return { c, kept, demotedMembers };
      })
      .filter(({ c, kept }) => {
        if (kept.length >= minSize) return true;
        for (const m of c.members) singletonUrls.push(m.url); // whole cluster dissolves
        return false;
      })
      .map(({ c, kept, demotedMembers }) => {
        for (const m of demotedMembers) singletonUrls.push(m.url);
        groupedPages += kept.length;

        const seedType = meta.get(c.seedUrl)?.content_type ?? null;
        const memberTypes = kept.map((m) => m.type);
        const intents: Intent[] = kept.map((m) =>
          classifyIntent({ title: m.title, slug: m.url, contentType: m.type }).label,
        );
        const authorities: AuthorityInput[] = kept.map((m) => ({
          url: m.url,
          inbound: 0, // O(members×corpus); intentionally skipped at this scale
          tokenCount: meta.get(m.url)?.token_count ?? null,
          clicks: null,
        }));

        const bodySims = kept
          .map((m) => (m.url === c.seedUrl ? null : bodyMap.get(bkey(c.seedUrl, m.url)) ?? null))
          .filter((x): x is number => x != null);
        const maxBodySim = bodySims.length ? Math.max(...bodySims) : 0;
        // A programmatic series is always "differentiate" (intentional variants).
        const action = c.isSeries
          ? "differentiate"
          : groupAction(maxBodySim, intents, t, { seedType, memberTypes });

        // Winner: for a pillar cluster the pillar (seed) IS the canonical
        // target, so the ★ must be the seed - otherwise "link spokes to the
        // pillar" and the highlighted winner would point at different pages.
        // For merge/consolidate/differentiate, pick by authority.
        const winner =
          action === "pillar"
            ? authorities.find((a) => a.url === c.seedUrl) ??
              authorities.reduce((best, cur) => pickWinner(best, cur))
            : authorities.reduce((best, cur) => pickWinner(best, cur));

        const members = kept
          .map((m, i) => ({
            url: m.url,
            title: m.title,
            type: m.type,
            intent: intents[i],
            matchSim: m.matchSim, // IDF-weighted topic overlap vs seed
            bodySim: m.url === c.seedUrl ? null : bodyMap.get(bkey(c.seedUrl, m.url)) ?? null,
            sharedTerms: m.sharedTerms,
            authority: Number(pageAuthority(authorities[i]).toFixed(4)),
            isWinner: m.url === winner.url,
            isSeed: m.url === c.seedUrl,
          }))
          .sort(
            (a, b) =>
              (b.isWinner ? 1 : 0) - (a.isWinner ? 1 : 0) ||
              (b.isSeed ? 1 : 0) - (a.isSeed ? 1 : 0) ||
              b.matchSim - a.matchSim,
          );

        return {
          size: kept.length,
          label: c.label,
          seedUrl: c.seedUrl,
          action,
          isSeries: !!c.isSeries,
          winnerUrl: winner.url,
          maxBodySim: Number(maxBodySim.toFixed(4)),
          members,
        };
      });

    groups.sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));

    // Browsable sample of unique-topic pages (capped) so "N unique-topic pages"
    // isn't a dead-end stat.
    const singletons = singletonUrls.slice(0, SINGLETON_CAP).map((url) => ({
      url,
      title: meta.get(url)?.title ?? null,
      type: meta.get(url)?.content_type ?? null,
    }));

    const body = {
      totalGroups: groups.length,
      corpusSize,
      groupedPages,
      singletonCount: singletonUrls.length,
      singletons,
      overlap,
      groups: groups.slice(0, limit),
    };
    groupsCache = { key: cacheKey, at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return errorResponse("/api/groups", e, { status: 500, publicMessage: "Failed to compute clusters.", extra: { groups: [] } });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
