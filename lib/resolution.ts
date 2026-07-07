/**
 * Pairwise resolution + winner selection (plans/01-conflict-automation.md,
 * Stages 7-8) for the live Conflict Checker: input page vs one matched page.
 *
 * Every branch is a numeric check against lib/thresholds.ts - no judgment
 * calls. Cluster-level resolution (Stage 6+) reuses these same primitives in
 * a later phase.
 */
import { THRESHOLDS, type Thresholds, type WinnerWeights } from "@/lib/thresholds";
import type { SignalScores } from "@/lib/signals";
import type { Intent } from "@/lib/intent";

/** Number of non-empty path segments in a URL, e.g. /blog/skill-gap → 2. */
function pathDepth(url: string): number {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* treat as raw path */
  }
  return path.split("/").filter(Boolean).length;
}

export type ResolutionAction =
  | "merge" // near-duplicate, same intent → 301 the loser into the winner
  | "consolidate" // strong overlap, same intent → keep winner, re-link others
  | "differentiate" // some overlap, same intent → rewrite to separate them
  | "keep-both" // different intent → no conflict
  | "pillar"; // hub seed + spokes of other types → link spokes to the pillar

/** Content types that act as a topic pillar (Content Clusters, PROJECTLOG §17). */
const PILLAR_TYPES = new Set(["category", "subcategory", "excellence-program"]);

/** Inputs to score a single page's authority (Stage 8 winner selection). */
export interface AuthorityInput {
  url: string;
  /** Internal inbound-link count (lib/inbound-links.fetchInboundCounts). */
  inbound: number;
  /** Content depth proxy - token/word count. */
  tokenCount: number | null;
  /** Organic traffic (pages.gsc_clicks_28d). Weighted 0 by default. */
  clicks?: number | null;
}

/** URL cleanliness in [0,1]: shorter, shallower paths score higher. */
export function urlCleanliness(url: string): number {
  // An absent URL (topic input) is NOT a clean page - it's not a page at all.
  // Return 0 so a topic input can never win a tie on cleanliness (see pickWinner).
  if (!url) return 0;
  // Uses raw path depth (segment count), independent of stopword filtering,
  // so "shallower URL wins" holds for any segments. Home (0) → 1.0.
  return 1 / (1 + pathDepth(url) / 4);
}

/** log-normalised helper so big counts don't dominate linearly. */
function logNorm(n: number, cap: number): number {
  if (n <= 0) return 0;
  return Math.min(1, Math.log10(n + 1) / Math.log10(cap + 1));
}

/**
 * Weighted authority score for one page. Higher = stronger survivor candidate.
 * Signals are normalised to 0..1 then combined with the configured weights.
 */
export function pageAuthority(
  p: AuthorityInput,
  weights: WinnerWeights = THRESHOLDS.winner,
): number {
  const inbound = logNorm(p.inbound, 50); // ~50 inlinks saturates
  const depth = logNorm(p.tokenCount ?? 0, 4000); // ~4k tokens saturates
  const clean = urlCleanliness(p.url);
  const traffic = logNorm(p.clicks ?? 0, 1000);
  return (
    weights.inbound * inbound +
    weights.depth * depth +
    weights.urlClean * clean +
    weights.traffic * traffic
  );
}

/** Pick the higher-authority page; ties broken by cleaner URL, then URL string.
 *  A page with no URL (a topic input, not yet published) can never win over a
 *  real page - it isn't a canonical target. */
export function pickWinner(
  a: AuthorityInput,
  b: AuthorityInput,
  weights: WinnerWeights = THRESHOLDS.winner,
): AuthorityInput {
  // An absent URL is never a valid canonical winner.
  if (!a.url && b.url) return b;
  if (!b.url && a.url) return a;

  const sa = pageAuthority(a, weights);
  const sb = pageAuthority(b, weights);
  if (sa !== sb) return sa > sb ? a : b;
  const ca = urlCleanliness(a.url);
  const cb = urlCleanliness(b.url);
  if (ca !== cb) return ca > cb ? a : b;
  // Deterministic final tie-break: lexicographically smaller URL, no input bias.
  return a.url <= b.url ? a : b;
}

export interface PairResolution {
  action: ResolutionAction;
  /** URL that should survive as canonical (undefined for keep-both). */
  winnerUrl?: string;
  /** Human-readable "why", built from the deciding signals. */
  reason: string;
}

/**
 * Decide what to do with an (input, match) pair. Deterministic branch:
 *   - different intent                      → keep-both
 *   - near-duplicate title/h1/slug OR body≥merge  → merge
 *   - body ≥ consolidate                    → consolidate
 *   - else (still same intent, above search floor) → differentiate
 */
export function decidePair(
  input: AuthorityInput,
  match: AuthorityInput,
  signals: SignalScores,
  inputIntent: Intent,
  matchIntent: Intent,
  t: Thresholds = THRESHOLDS,
  /** Whether the input has real title/h1/url metadata. False for topic inputs,
   *  where the title signal is a text-vs-title fallback that must NOT drive the
   *  near-duplicate merge gate (H1 review finding). */
  lexicalMeta = true,
  /** Content types of the two sides, when known. Enables the course↔course
   *  template-noise gate (PROJECTLOG 15G): course bodies share boilerplate that
   *  inflates cosine, so two *different* courses must not resolve to
   *  merge/consolidate off body similarity alone. */
  types?: { input: string | null; match: string | null },
): PairResolution {
  if (inputIntent !== matchIntent) {
    return {
      action: "keep-both",
      reason: `Different intent (${inputIntent} vs ${matchIntent}) - no conflict.`,
    };
  }

  // Course↔course template-noise gate. A pair of catalog courses is "the same
  // offering" only at the hard bar, or the softer bar with near-matching
  // titles. Distinct offerings (Express.js vs Node.js: body ~0.74-0.90 via
  // template, title Jaccard 0.5) are curated as different products - no merge.
  if (types?.input === "course" && types?.match === "course") {
    const sameOffering =
      signals.body >= t.groupSimCourse ||
      (signals.body >= t.groupSimCourseTitle &&
        lexicalMeta &&
        signals.title >= t.groupTitleJaccardCourse);
    if (!sameOffering) {
      return {
        action: "keep-both",
        reason: `Distinct course offerings - ${(signals.body * 100).toFixed(0)}% body similarity is mostly shared course-template boilerplate.`,
      };
    }
  }

  const winner = pickWinner(input, match, t.winner);
  const winnerUrl = winner.url;
  const nearDupMeta =
    lexicalMeta &&
    (signals.title >= t.titleJaccardDup ||
      signals.h1 >= t.h1JaccardDup ||
      signals.slug >= t.slugOverlapDup);

  if (signals.body >= t.bodyCosineMerge || nearDupMeta) {
    const why = nearDupMeta
      ? `near-identical ${signals.title >= t.titleJaccardDup ? "title" : signals.h1 >= t.h1JaccardDup ? "H1" : "URL"}`
      : `body ${(signals.body * 100).toFixed(0)}% similar`;
    return { action: "merge", winnerUrl, reason: `Same intent, ${why} → 301 into winner.` };
  }

  if (signals.body >= t.bodyCosineConsolidate) {
    return {
      action: "consolidate",
      winnerUrl,
      reason: `Same intent, body ${(signals.body * 100).toFixed(0)}% similar → keep winner, re-link the other.`,
    };
  }

  // Below the no-conflict floor with no metadata match: not actually a conflict.
  if (signals.body < t.noConflictFloor) {
    return {
      action: "keep-both",
      reason: `Same intent but only ${(signals.body * 100).toFixed(0)}% body overlap - not a conflict.`,
    };
  }

  return {
    action: "differentiate",
    winnerUrl,
    reason: `Same intent but only ${(signals.body * 100).toFixed(0)}% body overlap → rewrite to separate.`,
  };
}

/**
 * Cluster-level action for a group of ≥2 similar pages.
 *
 * For topic clusters (Content Clusters, PROJECTLOG §17) a healthy family is a
 * hub pillar + cross-type spokes - merge/differentiate don't apply, so when the
 * seed is a pillar type and the group mixes in other types the action is
 * `pillar` ("link spokes to the pillar"). Otherwise it falls back to the
 * intent/similarity ladder for same-type near-duplicates:
 *   - mixed intent            → differentiate (they serve different searchers)
 *   - large same-type family  → differentiate (a content series, not a pile to
 *                               301 into one - see below)
 *   - same intent, maxSim≥merge      → merge (collapse into the winner)
 *   - same intent, maxSim≥consolidate → consolidate
 *   - else                    → differentiate
 *
 * The large-family guard (PROJECTLOG §17L): a big same-type cluster is almost
 * always a SERIES - "skills in demand in {country}" ×27, "{role} roles &
 * responsibilities" ×13 - whose members target different searchers and rank
 * independently. "Merge → 301" there is actively harmful advice (redirecting 26
 * distinct pages into one destroys their rankings). Body cosine can't tell a
 * series from a dup pile because it's template-inflated (the whole reason the
 * clustering moved to topic tokens), so we gate merge/consolidate on size:
 * only small clusters (≤ groupMergeMaxSize) are collapse candidates.
 */
export function groupAction(
  maxBodySim: number,
  intents: Intent[],
  t: Thresholds = THRESHOLDS,
  /** Optional cluster shape - enables the pillar/spoke action for topic clusters. */
  shape?: { seedType?: string | null; memberTypes?: (string | null)[] },
): ResolutionAction {
  if (
    shape?.seedType &&
    PILLAR_TYPES.has(shape.seedType) &&
    (shape.memberTypes ?? []).some((mt) => mt && mt !== shape.seedType)
  ) {
    return "pillar";
  }
  const sameIntent = intents.length > 0 && intents.every((i) => i === intents[0]);
  if (!sameIntent) return "differentiate";
  // A large same-type family is a series, not a 301-able dup pile.
  if (intents.length > t.groupMergeMaxSize) return "differentiate";
  if (maxBodySim >= t.bodyCosineMerge) return "merge";
  if (maxBodySim >= t.bodyCosineConsolidate) return "consolidate";
  return "differentiate";
}
