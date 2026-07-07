/**
 * Programmatic blog SERIES (Content Clusters, PROJECTLOG §17N).
 *
 * Edstellar publishes template-generated blog families - "{X} Training
 * Companies" ×60, "{role} Roles & Responsibilities" ×50, "Skills in Demand in
 * {country}" ×55, etc. Topic-token clustering fragments these because it weights
 * each page's DISTINGUISHING token (the country / role-type / industry - unique
 * per page, so very high IDF) over the shared series token ("companies",
 * "roles responsibilities"), so same-series pages fall below the overlap bar and
 * split into many sub-clusters.
 *
 * The reliable identifier is the slug TEMPLATE, not the `category` tag (each
 * series spans 6+ categories). This module matches those templates so each
 * series collapses into ONE cluster, deterministically. Series pages are always
 * "differentiate" (intentional variants - never merge/301 a programmatic series).
 *
 * Pure + unit-tested (series.test.ts). Slug patterns are matched against the
 * `/blog/<slug>` segment only, so a course/category URL can never be pulled in.
 */
export interface Series {
  /** Human-readable cluster label. */
  name: string;
  /** Matched against the lowercased blog slug (the part after `/blog/`). */
  pattern: RegExp;
  /** Shared-term chips shown on each member ("why grouped"). */
  tokens: string[];
}

export const SERIES: Series[] = [
  {
    name: "Training Companies",
    pattern: /(?:^|-)training-companies(?:$|-)/,
    tokens: ["training companies"],
  },
  {
    name: "Roles & Responsibilities",
    pattern: /-roles-responsibilities(?:$|-)|-roles-and-responsibilities(?:$|-)/,
    tokens: ["roles responsibilities"],
  },
  {
    name: "In-Demand Skills",
    pattern: /skills-in-demand-in-|in-demand-skills|most-in-demand/,
    tokens: ["in-demand skills"],
  },
  {
    name: "Games & Exercises",
    pattern: /-activities-games-exercises|-games-for-employees|-activities-games(?:$|-)/,
    tokens: ["activities games exercises"],
  },
  {
    name: "Digital Transformation",
    pattern: /^digital-transformation(?:$|-)/,
    tokens: ["digital transformation"],
  },
  {
    name: "Work Culture",
    pattern: /-work-culture(?:$|-)|-workplace-culture(?:$|-)/,
    tokens: ["work culture"],
  },
];

/** The blog slug for a URL, or null if it isn't a `/blog/<slug>` URL. */
function blogSlug(url: string): string | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* raw path */
  }
  const m = path.toLowerCase().match(/\/blog\/([^/?#]+)/);
  return m ? m[1].replace(/\/+$/, "") : null;
}

/**
 * Return the SERIES a URL belongs to, or null. Only `/blog/<slug>` URLs can
 * match; the first pattern hit wins (the list is ordered by specificity).
 */
export function matchSeries(url: string | null | undefined, list: Series[] = SERIES): Series | null {
  if (!url) return null;
  const slug = blogSlug(url);
  if (!slug) return null;
  for (const s of list) if (s.pattern.test(slug)) return s;
  return null;
}
