import { neon } from "@neondatabase/serverless";
import { getChat, getEmbedder } from "@/lib/ai";
import { fetchAndExtract } from "@/lib/extract";
import { vectorSearchPages, toVectorLiteral } from "@/lib/search";
import {
  blendScore,
  similarityToBaseScore,
  conflictTypeFromScore,
} from "@/lib/score";
import type { SummaryResult } from "@/lib/ai/types";
import { log } from "@/lib/logger";

export interface ConflictMatchResult {
  url: string;
  title: string | null;
  contentType: string | null;
  similarity: number;
  conflictScore: number;
  conflictType: string;
  rationale: string;
  /** 2-4 short phrases both pages cover (populated by the LLM verdict). */
  overlap?: string[];
  /** Plain-language SEO issue summary. */
  issue?: string;
  /** Editorial owner URL for the matched page's topic, if set. When non-null
   *  + different from the matched URL, the matched page is a non-owner and
   *  the suggested action is "redirect to ownerUrl" (#25). */
  ownerUrl?: string | null;
  /** 28-day GSC clicks on the matched page — drives business-impact
   *  severity hint. Null when GSC isn't connected or page has no traffic. */
  gscClicks28d?: number | null;
  gscImpressions28d?: number | null;
}

export interface ConflictCheckResult {
  inputType: "url" | "topic";
  inputValue: string;
  summary: string;
  keywords: string[];
  /** The 4-8 word SEO query the LLM thinks this page targets. Use for SERP
   *  lookups instead of the often-too-short keywords[0]. */
  primaryQuery?: string;
  topScore: number;
  matches: ConflictMatchResult[];
  checkId?: number;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Impact-weighted match score. The base conflict score (0..100) gets a
 * multiplier based on the matched page's last-28-day GSC clicks and on
 * whether the match is the (orphan) duplicate of the editorial winner.
 *
 * Audit 10C (Session 8): the owner-bonus condition was inverted. The
 * comment correctly identified "cannibalizing the editorial winner is
 * the worst outcome" — so the +0.25 should apply when the *match* is a
 * NON-owner duplicate of the canonical winner (an orphan cannibal),
 * not when the match IS the owner itself. The prior code applied the
 * bonus to the legitimate owner page, ranking it above its own cannibals
 * in the result list — visually backwards. Flipped.
 *
 * Multiplier scale (clicks → factor): 0→1.0, 100→1.25, 1000→1.5, 10k→2.0.
 * Owner-cannibal bonus: +0.25.
 */
function impactWeighted(m: ConflictMatchResult): number {
  const clicks = m.gscClicks28d ?? 0;
  const trafficBoost = clicks <= 0 ? 0 : Math.min(1, Math.log10(clicks + 1) / 4);
  // Bonus when this match is a duplicate of the editorial winner (NOT
  // the winner itself). We need ownerUrl set AND it must differ from m.url.
  const isOrphanCannibal = !!m.ownerUrl && m.ownerUrl !== m.url;
  const ownerBoost = isOrphanCannibal ? 0.25 : 0;
  return m.conflictScore * (1 + trafficBoost + ownerBoost);
}

export interface ConflictCheckOpts {
  /** How many vector candidates to fetch from pgvector. Default 100. */
  vectorLimit?: number;
  /** How many of those to send to the LLM for full classification. Default 15. */
  classifyLimit?: number;
  /** Drop matches below this cosine similarity. 0..1, default 0.50 (raised from 0.30 in Session 6 H11). */
  minSimilarity?: number;
  createdBy?: string;
  persist?: boolean;
  /** Legacy alias for vectorLimit (older callers). */
  limit?: number;
}

/**
 * The headline flow: summarize a URL/topic, embed it, vector-search the corpus,
 * LLM-classify the top N, and persist.
 *
 * Why two limits? Cost. `vectorLimit` is how many candidates we *return* (cheap:
 * one pgvector query). `classifyLimit` is how many we ask the LLM to explain
 * (expensive: 1 chat call total but token-bounded by N).
 * Matches between classifyLimit+1 and vectorLimit get a similarity-derived
 * score, conflict_type="needs-review", and an empty rationale. The UI can call
 * /api/check/classify-one to fill them in lazily.
 */
export async function runConflictCheck(
  rawInput: string,
  opts: ConflictCheckOpts = {},
): Promise<ConflictCheckResult> {
  const input = rawInput.trim();
  const inputType: "url" | "topic" = isUrl(input) ? "url" : "topic";
  const chat = getChat();
  const embedder = getEmbedder();

  const vectorLimit  = opts.vectorLimit ?? opts.limit ?? 100;
  const classifyLimit = Math.min(opts.classifyLimit ?? 15, vectorLimit);
  // Audit H11 (Session 6): raised the default floor from 0.30 to 0.50 so
  // results stay above the documented noise band (lib/score.ts:9). The
  // env override lets you re-loosen for debugging without a redeploy.
  const envFloor = Number(process.env.CONFLICT_MIN_SIMILARITY);
  const minSimilarity =
    opts.minSimilarity ?? (Number.isFinite(envFloor) && envFloor > 0 ? envFloor : 0.50);

  // 1. Build a summary + dense search synopsis.
  let summaryResult: SummaryResult;
  if (inputType === "url") {
    const page = await fetchAndExtract(input);
    summaryResult = await chat.summarize({
      title: page.title ?? undefined,
      content: [page.title, page.h1, page.contentText].filter(Boolean).join("\n"),
      isTopic: false,
    });
  } else {
    summaryResult = await chat.summarize({ content: input, isTopic: true });
  }

  // 2. Embed the candidate and find nearest corpus pages.
  const embedText = `${summaryResult.searchSynopsis}\n${summaryResult.keywords.join(", ")}`;
  const [embedding] = await embedder.embed([embedText]);
  const nearest = await vectorSearchPages(embedding, {
    limit: vectorLimit,
    excludeUrl: inputType === "url" ? input : undefined,
  });
  // Drop matches below the threshold — keeps the UI signal-to-noise sane.
  const meaningful = nearest.filter((m) => m.similarity >= minSimilarity);

  // 3. LLM judges only the top `classifyLimit` (cost control).
  const toClassify = meaningful.slice(0, classifyLimit);
  const verdicts = toClassify.length
    ? await chat.classifyConflicts({
        candidateSummary: `${summaryResult.summary}\n${summaryResult.searchSynopsis}`,
        matches: toClassify.map((m) => ({
          url: m.url,
          title: m.title,
          snippet: m.snippet,
          similarity: m.similarity,
        })),
      })
    : [];
  const verdictByUrl = new Map(verdicts.map((v) => [v.url, v]));

  // 4. Blend vector + LLM scores. Un-classified matches get
  //    a similarity-derived score and conflictType="needs-review".
  const matches: ConflictMatchResult[] = meaningful
    .map((m) => {
      const base = similarityToBaseScore(m.similarity);
      const v = verdictByUrl.get(m.url);
      const conflictScore = blendScore(base, v?.conflictScore);
      const conflictType = v
        ? (v.conflictType ?? conflictTypeFromScore(conflictScore))
        : "needs-review";
      return {
        url: m.url,
        title: m.title,
        contentType: m.contentType,
        similarity: m.similarity,
        conflictScore,
        conflictType,
        rationale: v?.rationale ?? "",
        overlap: v?.overlap,
        issue: v?.issue,
        ownerUrl: m.ownerUrl,
        gscClicks28d: m.gscClicks28d,
        gscImpressions28d: m.gscImpressions28d,
      };
    })
    // Sort by impact-weighted score: a 70%-conflict with a 12k-clicks/mo page
    // outranks a 90%-conflict with a dead page.
    .sort((a, b) => impactWeighted(b) - impactWeighted(a));

  const topScore = matches.length ? matches[0].conflictScore : 0;

  const result: ConflictCheckResult = {
    inputType,
    inputValue: input,
    summary: summaryResult.summary,
    keywords: summaryResult.keywords,
    primaryQuery: summaryResult.primaryQuery,
    topScore,
    matches,
  };

  // 5. Persist (best-effort).
  if (opts.persist !== false && process.env.DATABASE_URL) {
    try {
      result.checkId = await persistCheck(result, embedding, opts.createdBy);
    } catch (e) {
      log.warn("conflict persist failed", { error: (e as Error).message });
    }
  }

  return result;
}

async function persistCheck(
  result: ConflictCheckResult,
  embedding: number[],
  createdBy?: string,
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql.query(
    `INSERT INTO checks (input_type, input_value, summary, keywords, candidate_embedding, top_score, created_by)
     VALUES ($1,$2,$3,$4,$5::vector,$6,$7) RETURNING id`,
    [
      result.inputType,
      result.inputValue,
      result.summary,
      JSON.stringify(result.keywords),
      toVectorLiteral(embedding),
      result.topScore,
      createdBy ?? null,
    ],
  )) as { id: number }[];
  const checkId = Number(rows[0]!.id);

  // Audit H8 (Session 6): persist enrichment fields the API response already
  // returns (overlap, issue, ownerUrl, gscClicks28d) so history reads stay
  // faithful. Also batched into a single UNNEST INSERT — the prior N+1 loop
  // generated len(matches) round-trips per check.
  if (result.matches.length) {
    const len = result.matches.length;
    const checkIds = new Array<number>(len).fill(checkId);
    const urls = result.matches.map((m) => m.url);
    const titles = result.matches.map((m) => m.title);
    const sims = result.matches.map((m) => m.similarity);
    const scores = result.matches.map((m) => m.conflictScore);
    const types = result.matches.map((m) => m.conflictType);
    const rationales = result.matches.map((m) => m.rationale);
    const ranks = Array.from({ length: len }, (_, i) => i + 1);
    const overlaps = result.matches.map((m) =>
      m.overlap && m.overlap.length ? m.overlap : null,
    );
    const issues = result.matches.map((m) => m.issue ?? null);
    const ownerUrls = result.matches.map((m) => m.ownerUrl ?? null);
    const clicks = result.matches.map((m) => m.gscClicks28d ?? null);
    await sql.query(
      `INSERT INTO check_matches
         (check_id, page_url, page_title, similarity, conflict_score,
          conflict_type, rationale, rank, overlap, issue, owner_url, gsc_clicks_28d)
       SELECT * FROM unnest(
         $1::int[], $2::text[], $3::text[], $4::real[], $5::int[],
         $6::text[], $7::text[], $8::int[], $9::text[][], $10::text[],
         $11::text[], $12::int[]
       )`,
      [
        checkIds, urls, titles, sims, scores,
        types, rationales, ranks, overlaps, issues,
        ownerUrls, clicks,
      ],
    );
  }
  return checkId;
}
