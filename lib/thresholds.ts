/**
 * Single source of truth for every numeric cutoff and weight in the
 * content-conflict automation (plans/01-conflict-automation.md).
 *
 * The whole point of the tool is "each human judgment call becomes a
 * deterministic check with a signal and a threshold." Keeping them here —
 * env-overridable — means a site can be tuned without touching code.
 *
 * Env overrides: any key can be set via `CONFLICT_<UPPER_SNAKE>`, e.g.
 * `CONFLICT_BODY_COSINE_MERGE=0.82`. Winner weights via
 * `CONFLICT_WINNER_INBOUND`, `CONFLICT_WINNER_DEPTH`, etc.
 */

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface WinnerWeights {
  /** Internal inbound-link authority (hardest signal to rebuild → highest). */
  inbound: number;
  /** Content depth proxy (token/word count). */
  depth: number;
  /** URL cleanliness (shorter, shallower slug wins ties). */
  urlClean: number;
  /**
   * Organic traffic (pages.gsc_clicks_28d). OFF by default (0): GSC surfacing
   * was intentionally removed from the Conflict Checker. Set > 0 to weight it.
   */
  traffic: number;
}

export interface Thresholds {
  /** Body cosine ≥ this ⇒ same-intent pair is a merge candidate. */
  bodyCosineMerge: number;
  /** Body cosine ≥ this (but < merge) ⇒ consolidate candidate. */
  bodyCosineConsolidate: number;
  /** Title token Jaccard ≥ this ⇒ treat as near-duplicate title. */
  titleJaccardDup: number;
  /** H1 token Jaccard ≥ this ⇒ near-duplicate heading. */
  h1JaccardDup: number;
  /** Slug token overlap ≥ this ⇒ near-duplicate URL. */
  slugOverlapDup: number;
  /** Below this body cosine (and no near-dup metadata) a same-intent pair is
   *  NOT a conflict — keep both. Guards decidePair when called with a low body. */
  noConflictFloor: number;
  /** Corpus-grouping: body cosine ≥ this makes an edge for NON-course
   *  same-type pairs (blogs, categories, …). Editorial content is diverse, so
   *  real conflicts live lower than course-template noise. */
  groupSimilarity: number;
  /** Corpus-grouping: course↔course pairs group only at this cosine — course
   *  bodies share heavy template boilerplate which inflates similarity, so a
   *  much higher bar is needed to mean "actually the same offering". */
  groupSimCourse: number;
  /** Corpus-grouping: course↔course fallback — group at this (lower) cosine
   *  when the titles ALSO near-match (Jaccard ≥ groupTitleJaccardCourse). */
  groupSimCourseTitle: number;
  /** Title-token Jaccard needed for the course fallback rule above. Calibrated
   *  so "Express.js Training" vs "Node.js Training" (0.5) does NOT group. */
  groupTitleJaccardCourse: number;
  /** Corpus-grouping: an edge needs ≥1 lexical signal (title/H1/description/
   *  slug) at this plural-normalized Jaccard — body similarity alone is never
   *  enough below the self-sufficient bar. */
  groupSupportJaccard: number;
  /** Corpus-grouping: body cosine at/above this is a near-verbatim duplicate
   *  and needs no lexical corroboration. */
  groupBodySelfSufficient: number;
  /** Corpus-grouping: nearest-neighbours probed per page (ANN top-k). */
  groupTopK: number;
  /** Weights used to pick the surviving (canonical) page. */
  winner: WinnerWeights;
}

export const THRESHOLDS: Thresholds = {
  bodyCosineMerge:       envNum("CONFLICT_BODY_COSINE_MERGE", 0.8),
  bodyCosineConsolidate: envNum("CONFLICT_BODY_COSINE_CONSOLIDATE", 0.55),
  titleJaccardDup:       envNum("CONFLICT_TITLE_JACCARD_DUP", 0.8),
  h1JaccardDup:          envNum("CONFLICT_H1_JACCARD_DUP", 0.8),
  slugOverlapDup:        envNum("CONFLICT_SLUG_OVERLAP_DUP", 0.6),
  noConflictFloor:       envNum("CONFLICT_NO_CONFLICT_FLOOR", 0.5),
  groupSimilarity:        envNum("CONFLICT_GROUP_SIMILARITY", 0.85),
  groupSimCourse:         envNum("CONFLICT_GROUP_SIM_COURSE", 0.93),
  groupSimCourseTitle:    envNum("CONFLICT_GROUP_SIM_COURSE_TITLE", 0.88),
  groupTitleJaccardCourse: envNum("CONFLICT_GROUP_TITLE_JACCARD_COURSE", 0.6),
  groupSupportJaccard:     envNum("CONFLICT_GROUP_SUPPORT_JACCARD", 0.3),
  groupBodySelfSufficient: envNum("CONFLICT_GROUP_BODY_SELF_SUFFICIENT", 0.93),
  groupTopK:              envNum("CONFLICT_GROUP_TOPK", 5),
  winner: {
    inbound:  envNum("CONFLICT_WINNER_INBOUND", 0.45),
    depth:    envNum("CONFLICT_WINNER_DEPTH", 0.3),
    urlClean: envNum("CONFLICT_WINNER_URLCLEAN", 0.25),
    traffic:  envNum("CONFLICT_WINNER_TRAFFIC", 0),
  },
};
