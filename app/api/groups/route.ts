import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { neonRows } from "@/lib/db";
import { connectedComponents, evaluatePair, type Edge, type EvidenceSignal } from "@/lib/cluster";
import { classifyIntent, type Intent } from "@/lib/intent";
import { pageAuthority, pickWinner, groupAction, type AuthorityInput } from "@/lib/resolution";
import { THRESHOLDS } from "@/lib/thresholds";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/groups — Content Clusters: group similar pages across the WHOLE
 * corpus (Stage 6+7+8 of plans/01-conflict-automation.md, precision rules in
 * PROJECTLOG §15G).
 *
 * Pipeline:
 *  1. One pgvector top-k lateral join over every LIVE embedded page. Pages that
 *     redirect / are canonicalized elsewhere (marked by scripts/detect-redirects.ts
 *     via canonical_url + is_stale) are excluded on BOTH sides — a 301 and its
 *     target must never appear as a "duplicate pair".
 *  2. Type-aware edge gating (lib/cluster shouldGroupPair): same-type only;
 *     course↔course needs the high template-noise bar; editorial types group
 *     at the lower threshold.
 *  3. Connected components → per-cluster winner + action + per-member
 *     "% match to nearest cluster-mate" (the *why grouped*).
 *
 * Query: ?threshold (overrides non-course bar) ?topK ?minSize ?limit.
 * Gated with gateLlmEndpoint: this runs a corpus-wide pgvector scan, so it is
 * rate-limited / key-gated rather than relying on the proxy session gate
 * (a no-op when AUTH_ENABLED=false).
 */
interface PairRow {
  a_url: string; a_title: string | null; a_type: string | null; a_tok: number | null;
  a_h1: string | null; a_desc: string | null;
  b_url: string; b_title: string | null; b_type: string | null; b_tok: number | null;
  b_h1: string | null; b_desc: string | null;
  sim: number;
}

/** Live-page predicate: not stale, canonical absent or self. */
const LIVE = (alias: string) =>
  `COALESCE(${alias}.is_stale, false) = false
   AND (${alias}.canonical_url IS NULL
        OR rtrim(${alias}.canonical_url, '/') = rtrim(${alias}.url, '/'))`;

export async function GET(request: NextRequest) {
  const gate = await gateLlmEndpoint(request, "groups", { max: 15, windowSec: 60 });
  if (gate) return gate;
  try {
    const p = new URL(request.url).searchParams;
    const overrideThr = Number(p.get("threshold"));
    const t = Number.isFinite(overrideThr) && overrideThr > 0
      ? { ...THRESHOLDS, groupSimilarity: clamp(overrideThr, 0.5, 0.99) }
      : THRESHOLDS;
    const topK = Math.min(Math.max(Number(p.get("topK")) || t.groupTopK, 1), 20);
    const minSize = Math.max(2, Number(p.get("minSize")) || 2);
    const limit = Math.min(Math.max(Number(p.get("limit")) || 100, 1), 500);
    // Fetch down to the lowest rule bar; shouldGroupPair applies the real gates.
    const fetchBar = Math.min(t.groupSimilarity, t.groupSimCourseTitle);

    const client = neon(process.env.DATABASE_URL || "postgresql://user:password@localhost/db");
    const rawPairs = neonRows<PairRow>(await client.query(
      `SELECT p1.url a_url, p1.title a_title, p1.content_type a_type, p1.token_count a_tok,
              p1.h1 a_h1, p1.meta_description a_desc,
              p2.url b_url, p2.title b_title, p2.content_type b_type, p2.token_count b_tok,
              p2.h1 b_h1, p2.meta_description b_desc,
              1 - (p1.embedding <=> p2.embedding) sim
       FROM pages p1
       CROSS JOIN LATERAL (
         SELECT id, url, title, content_type, token_count, h1, meta_description, embedding
         FROM pages p2
         WHERE p2.embedding IS NOT NULL AND p2.id <> p1.id
           AND ${LIVE("p2")}
         ORDER BY p1.embedding <=> p2.embedding
         LIMIT $2
       ) p2
       WHERE p1.embedding IS NOT NULL
         AND ${LIVE("p1")}
         AND 1 - (p1.embedding <=> p2.embedding) >= $1`,
      [fetchBar, topK],
    ));

    const corpusSize = neonRows<{ n: number }>(
      await client.query(
        `SELECT count(*)::int n FROM pages p WHERE p.embedding IS NOT NULL AND ${LIVE("p")}`,
      ),
    )[0]?.n ?? 0;

    // Dedupe undirected pairs, then apply the multi-signal evidence gates.
    const seen = new Set<string>();
    const pairs: PairRow[] = [];
    const pairSupport: EvidenceSignal[][] = [];
    for (const r of rawPairs) {
      const key = r.a_url < r.b_url ? `${r.a_url} ${r.b_url}` : `${r.b_url} ${r.a_url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ev = evaluatePair(
        {
          aType: r.a_type, bType: r.b_type,
          aTitle: r.a_title, bTitle: r.b_title,
          aH1: r.a_h1, bH1: r.b_h1,
          aDescription: r.a_desc, bDescription: r.b_desc,
          aUrl: r.a_url, bUrl: r.b_url,
          sim: Number(r.sim),
        },
        t,
      );
      if (!ev.group) continue;
      pairs.push(r);
      pairSupport.push(ev.support);
    }

    if (pairs.length === 0) {
      return NextResponse.json({
        groups: [], totalGroups: 0, totalPairs: 0, corpusSize,
        groupedPages: 0, threshold: t.groupSimilarity,
      });
    }

    // Metadata + per-member strongest match (the "why grouped" number) and the
    // evidence signals of that strongest edge (the "why grouped" tags).
    const meta = new Map<string, { title: string | null; type: string | null; tokens: number | null }>();
    const nearestSim = new Map<string, number>();
    const evidence = new Map<string, EvidenceSignal[]>();
    pairs.forEach((r, i) => {
      if (!meta.has(r.a_url)) meta.set(r.a_url, { title: r.a_title, type: r.a_type, tokens: r.a_tok });
      if (!meta.has(r.b_url)) meta.set(r.b_url, { title: r.b_title, type: r.b_type, tokens: r.b_tok });
      const s = Number(r.sim);
      if (s > (nearestSim.get(r.a_url) ?? 0)) { nearestSim.set(r.a_url, s); evidence.set(r.a_url, pairSupport[i]); }
      if (s > (nearestSim.get(r.b_url) ?? 0)) { nearestSim.set(r.b_url, s); evidence.set(r.b_url, pairSupport[i]); }
    });

    // Connected components over the gated pair graph.
    const edges: Edge[] = pairs.map((r) => [r.a_url, r.b_url] as Edge);
    const components = connectedComponents(edges).filter((g) => g.length >= minSize);
    const groupOf = new Map<string, number>();
    components.forEach((urls, gi) => urls.forEach((u) => groupOf.set(u, gi)));

    // Max intra-group similarity — bucketed by component.
    const maxSim = new Array(components.length).fill(0);
    for (const r of pairs) {
      const gi = groupOf.get(r.a_url);
      if (gi === undefined || groupOf.get(r.b_url) !== gi) continue;
      if (Number(r.sim) > maxSim[gi]) maxSim[gi] = Number(r.sim);
    }

    // NOTE: inbound-link authority is intentionally NOT computed here —
    // fetchInboundCounts is O(members × corpus) and times out at this scale.
    // Cluster winners use content depth + URL cleanliness.
    const groups = components.map((urls, gi) => {
      const authorities: AuthorityInput[] = urls.map((url) => ({
        url,
        inbound: 0,
        tokenCount: meta.get(url)?.tokens ?? null,
        clicks: null,
      }));
      const winner = authorities.reduce((best, cur) => pickWinner(best, cur));

      const intents: Intent[] = urls.map((url) => {
        const m = meta.get(url);
        return classifyIntent({ title: m?.title, slug: url, contentType: m?.type }).label;
      });
      const action = groupAction(maxSim[gi], intents);
      const type = meta.get(urls[0])?.type ?? "page";
      const sameIntent = intents.every((x) => x === intents[0]);
      const reason = `${urls.length} ${type} pages with up to ${(maxSim[gi] * 100).toFixed(0)}% content overlap${
        sameIntent ? ` targeting the same ${intents[0]} intent` : ", mixed search intent"
      }.`;

      const members = urls
        .map((url, i) => ({
          url,
          title: meta.get(url)?.title ?? null,
          type: meta.get(url)?.type ?? null,
          intent: intents[i],
          matchSim: Number((nearestSim.get(url) ?? 0).toFixed(4)),
          evidence: evidence.get(url) ?? [],
          authority: Number(pageAuthority(authorities[i]).toFixed(4)),
          isWinner: url === winner.url,
        }))
        .sort((a, b) => (b.isWinner ? 1 : 0) - (a.isWinner ? 1 : 0) || b.matchSim - a.matchSim);

      return {
        size: urls.length,
        maxSimilarity: Number(maxSim[gi].toFixed(4)),
        action,
        winnerUrl: winner.url,
        reason,
        members,
      };
    });

    groups.sort((a, b) => b.size - a.size || b.maxSimilarity - a.maxSimilarity);

    return NextResponse.json({
      totalGroups: groups.length,
      totalPairs: pairs.length,
      corpusSize,
      groupedPages: groupOf.size,
      threshold: t.groupSimilarity,
      groups: groups.slice(0, limit),
    });
  } catch (e) {
    return errorResponse("/api/groups", e, { status: 500, publicMessage: "Failed to compute clusters.", extra: { groups: [] } });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
