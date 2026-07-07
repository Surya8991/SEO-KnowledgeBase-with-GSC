/**
 * Single source of truth for every numeric cutoff and weight in the
 * content-conflict automation (plans/01-conflict-automation.md).
 *
 * The whole point of the tool is "each human judgment call becomes a
 * deterministic check with a signal and a threshold." Keeping them here -
 * env-overridable - means a site can be tuned without touching code.
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
   *  NOT a conflict - keep both. Guards decidePair when called with a low body. */
  noConflictFloor: number;
  /** Conflict Checker course↔course gate (decidePair): two catalog courses are
   *  "the same offering" only at this cosine - course bodies share heavy
   *  template boilerplate which inflates similarity, so a much higher bar is
   *  needed. NOT used by the Content Clusters engine (that's topic-token based). */
  groupSimCourse: number;
  /** Conflict Checker course↔course fallback (decidePair): treat as same
   *  offering at this (lower) cosine when the titles ALSO near-match
   *  (Jaccard ≥ groupTitleJaccardCourse). */
  groupSimCourseTitle: number;
  /** Title-token Jaccard needed for the course fallback rule above (decidePair).
   *  Calibrated so "Express.js Training" vs "Node.js Training" (0.5) does NOT
   *  count as the same offering. */
  groupTitleJaccardCourse: number;
  /** Content Clusters (topic-token leader clustering, PROJECTLOG §17): tokens
   *  appearing in ≥ this share of the corpus are template noise ("training",
   *  "corporate") and are dropped from topic keys. A DF cap auto-learns the
   *  template vocabulary - no hardcoded stopword list. */
  topicDfCap: number;
  /** Content Clusters: IDF-weighted distinctive-token Jaccard a page needs vs a
   *  seed to join its cluster. Below this it becomes (or joins) another seed.
   *  Calibrated live (PROJECTLOG §17J/§17M): after the §17K bigram fix the true
   *  pair big-data-cat↔big-data-blog = 0.274, hardest false sibling
   *  big-data↔data-analytics = 0.103; 0.16 sits between (0.057 margin above the
   *  false sibling) and clusters more of the corpus than the earlier 0.18. */
  topicOverlap: number;
  /** Content Clusters: minimum body cosine a member needs vs its seed - a topic
   *  match with near-zero body overlap is demoted to a singleton. */
  topicBodyFloor: number;
  /** Content Clusters (PROJECTLOG §17L): max same-type cluster size that may be
   *  suggested for merge/consolidate. Larger same-type families are treated as a
   *  content SERIES (country/role variants) and get "differentiate" - you don't
   *  301 twenty-seven distinct pages into one. */
  groupMergeMaxSize: number;
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
  groupSimCourse:         envNum("CONFLICT_GROUP_SIM_COURSE", 0.93),
  groupSimCourseTitle:    envNum("CONFLICT_GROUP_SIM_COURSE_TITLE", 0.88),
  groupTitleJaccardCourse: envNum("CONFLICT_GROUP_TITLE_JACCARD_COURSE", 0.6),
  topicDfCap:             envNum("CONFLICT_TOPIC_DF_CAP", 0.05),
  topicOverlap:           envNum("CONFLICT_TOPIC_OVERLAP", 0.16),
  topicBodyFloor:         envNum("CONFLICT_TOPIC_BODY_FLOOR", 0.65),
  groupMergeMaxSize:      envNum("CONFLICT_GROUP_MERGE_MAX_SIZE", 4),
  winner: {
    inbound:  envNum("CONFLICT_WINNER_INBOUND", 0.45),
    depth:    envNum("CONFLICT_WINNER_DEPTH", 0.3),
    urlClean: envNum("CONFLICT_WINNER_URLCLEAN", 0.25),
    traffic:  envNum("CONFLICT_WINNER_TRAFFIC", 0),
  },
};
