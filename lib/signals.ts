/**
 * Per-signal similarity primitives for the content-conflict tool
 * (plans/01-conflict-automation.md, Stage 4).
 *
 * Signals are computed and reported SEPARATELY — never blended into one
 * number — so a reviewer can see *why* two pages were grouped. Identical
 * titles with different bodies is a metadata problem; similar bodies with
 * different titles is true content overlap.
 *
 * All functions are pure and deterministic (unit-tested in signals.test.ts).
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
  "your", "you", "our", "we", "is", "are", "at", "by", "from", "edstellar",
]);

/** Lowercase → split on non-alphanumerics → drop stopwords + short tokens. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Jaccard overlap of two token sets: |A∩B| / |A∪B|, in [0,1]. */
export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Path segment tokens of a URL, e.g. /blog/skill-gap → ["blog","skill","gap"]. */
export function slugTokens(url: string | null | undefined): string[] {
  if (!url) return [];
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* treat as raw path */
  }
  return tokenize(path.replace(/\//g, " "));
}

/** Slug token overlap (Jaccard of path tokens), in [0,1]. */
export function slugOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return jaccard(slugTokens(a), slugTokens(b));
}

export interface SignalInput {
  title?: string | null;
  h1?: string | null;
  url?: string | null;
  /** Optional free text for topic inputs (no title/h1/url). */
  text?: string | null;
}

export interface SignalScores {
  /** Title token Jaccard, 0..1. */
  title: number;
  /** H1 token Jaccard, 0..1. */
  h1: number;
  /** Slug token overlap, 0..1. */
  slug: number;
  /**
   * Body content similarity, 0..1. Passed in from the caller (cosine on
   * embeddings — the measured signal the corpus already stores). Kept in the
   * same struct so all four signals travel together.
   */
  body: number;
}

/**
 * Compute the three lexical signals (title/h1/slug) between an input page and
 * a candidate. `body` is supplied by the caller (embedding cosine) and passed
 * straight through so the four signals stay together.
 *
 * For topic inputs (no title/h1/url) the lexical signals fall back to comparing
 * the topic `text` against the candidate's title.
 */
export function signalScores(
  input: SignalInput,
  candidate: SignalInput,
  body: number,
): SignalScores {
  const inputTitleTokens = input.title
    ? tokenize(input.title)
    : tokenize(input.text);
  return {
    title: jaccard(inputTitleTokens, tokenize(candidate.title)),
    h1: jaccard(tokenize(input.h1), tokenize(candidate.h1)),
    slug: slugOverlap(input.url, candidate.url),
    body: Math.max(0, Math.min(1, body)),
  };
}
