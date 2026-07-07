/**
 * Per-signal similarity primitives for the content-conflict tool
 * (plans/01-conflict-automation.md, Stage 4).
 *
 * Signals are computed and reported SEPARATELY - never blended into one
 * number - so a reviewer can see *why* two pages were grouped. Identical
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
   * embeddings - the measured signal the corpus already stores). Kept in the
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
  /**
   * Optional corpus DF index (PROJECTLOG §17). When supplied, the title & slug
   * Jaccards are computed over DISTINCTIVE tokens only - template words shared
   * by every page ("corporate", "training", "courses") are dropped so the
   * lexical bars stop lighting up for pure template matches. Omit for the
   * legacy raw-token behaviour (unchanged).
   */
  df?: DfIndex,
): SignalScores {
  const filt = (toks: string[]) => (df ? distinctiveTokens(toks, df) : toks);
  const inputTitleTokens = input.title
    ? tokenize(input.title)
    : tokenize(input.text);
  return {
    title: jaccard(filt(inputTitleTokens), filt(tokenize(candidate.title))),
    h1: jaccard(tokenize(input.h1), tokenize(candidate.h1)),
    slug: jaccard(filt(slugTokens(input.url)), filt(slugTokens(candidate.url))),
    body: Math.max(0, Math.min(1, body)),
  };
}

// ── Topic-token layer (PROJECTLOG §17) ────────────────────────────────────
// Shared by Content Clusters (lib/cluster.ts) and the Conflict Checker's
// lexical signals. The corpus document-frequency of a token cleanly separates
// template vocabulary ("training" 82%, "corporate" 78%) from topic vocabulary
// ("big" 0.6%, "sales" 1.2%) - so a DF cap auto-learns the stopword list.

/** Last non-empty path segment of a URL, tokenized. `/category/big-data-training`
 *  → ["big","data","training"]. Section prefixes (/category/, /blog/) are
 *  dropped - they polluted topic keys in the full-corpus simulation. */
export function lastSegmentTokens(url: string | null | undefined): string[] {
  if (!url) return [];
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* raw path */
  }
  const seg = path.split("/").filter(Boolean).pop() ?? "";
  return tokenize(seg);
}

/** Adjacent-pair bigrams from a token list: ["big","data","x"] → ["big data","data x"]. */
function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/** A page's raw terms for topic keying: unigrams (union of title/h1/last-slug)
 *  + bigrams (per-field adjacency, so cross-field noise pairs aren't formed). */
export function pageTerms(input: SignalInput): { unigrams: string[]; bigrams: string[] } {
  const fields = [tokenize(input.title), tokenize(input.h1), lastSegmentTokens(input.url)].filter(
    (f) => f.length > 0,
  );
  const uni = new Set<string>();
  const bi = new Set<string>();
  for (const f of fields) {
    for (const t of f) uni.add(t);
    for (const b of bigrams(f)) bi.add(b);
  }
  return { unigrams: [...uni], bigrams: [...bi] };
}

/** Corpus document-frequency index over unigrams + bigrams. */
export interface DfIndex {
  df: Map<string, number>;
  n: number;
  cap: number;
}

/** Build a DF index from every page's terms. `cap` is the DF-ratio above which
 *  a term is considered template noise (default 0.05). */
export function buildDfIndex(pages: SignalInput[], cap = 0.05): DfIndex {
  const df = new Map<string, number>();
  for (const p of pages) {
    const { unigrams, bigrams: bi } = pageTerms(p);
    for (const t of new Set([...unigrams, ...bi])) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { df, n: pages.length, cap };
}

/** A term is distinctive (topic, not template) if it appears in < cap of docs. */
export function isDistinctive(term: string, idx: DfIndex): boolean {
  if (idx.n === 0) return true;
  return (idx.df.get(term) ?? 0) / idx.n < idx.cap;
}

/** Smoothed inverse document frequency - rarer terms weigh more. */
export function idf(term: string, idx: DfIndex): number {
  const d = idx.df.get(term) ?? 0;
  return Math.log((idx.n + 1) / (d + 1)) + 1;
}

/** Filter a token list to only its distinctive (topic) members. */
export function distinctiveTokens(tokens: string[], idx: DfIndex): string[] {
  return tokens.filter((t) => isDistinctive(t, idx));
}

/** A page's distinctive topic key: template terms removed. */
export interface TopicKey {
  unigrams: string[];
  bigrams: string[];
}

export function topicKey(input: SignalInput, idx: DfIndex): TopicKey {
  const { unigrams, bigrams: bi } = pageTerms(input);
  const uni = unigrams.filter((t) => isDistinctive(t, idx));
  const uniSet = new Set(uni);
  return {
    unigrams: uni,
    // A bigram is a genuine topic phrase only if BOTH its words are distinctive.
    // "safety corporate" / "corporate chemical" contain the template word
    // "corporate" - the *bigram* is rare (would pass a bigram-DF test) but it's
    // template noise, and it made one topic's label read like three (PROJECTLOG
    // §17K). Requiring both unigrams distinctive drops it cleanly.
    bigrams: bi.filter((t) => {
      const [w1, w2] = t.split(" ");
      return uniSet.has(w1) && uniSet.has(w2) && isDistinctive(t, idx);
    }),
  };
}

function weightMap(key: TopicKey, idx: DfIndex, bigramWeight: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of key.unigrams) m.set(t, idf(t, idx));
  for (const t of key.bigrams) m.set(t, idf(t, idx) * bigramWeight);
  return m;
}

/** IDF-weighted Jaccard between two topic keys, bigrams up-weighted. In [0,1].
 *  This is the grouping score: big-data↔sales ≈ 0, big-data↔big-data-blog high. */
export function topicOverlap(
  a: TopicKey,
  b: TopicKey,
  idx: DfIndex,
  bigramWeight = 2,
): number {
  const A = weightMap(a, idx, bigramWeight);
  const B = weightMap(b, idx, bigramWeight);
  let inter = 0;
  let union = 0;
  for (const t of new Set([...A.keys(), ...B.keys()])) {
    const va = A.get(t) ?? 0;
    const vb = B.get(t) ?? 0;
    inter += Math.min(va, vb);
    union += Math.max(va, vb);
  }
  return union === 0 ? 0 : inter / union;
}

/** Shared distinctive terms between two topic keys (bigrams first) - the
 *  human-readable "why grouped" tags, e.g. ["big data", "big"]. */
export function sharedTopicTerms(a: TopicKey, b: TopicKey): string[] {
  const bset = new Set([...b.unigrams, ...b.bigrams]);
  const shared = [...a.bigrams.filter((t) => bset.has(t)), ...a.unigrams.filter((t) => bset.has(t))];
  return [...new Set(shared)];
}

/** Listicle / filler words that make a poor topic label ("Top 11 Most…").
 *  DISPLAY-ONLY — never used for matching, so it can't affect clustering. */
const LABEL_FILLER = new Set([
  "top", "most", "best", "list", "guide", "complete", "ultimate", "essential",
  "common", "key", "examples", "example", "ways", "tips", "types", "type",
  "popular", "leading", "great", "good", "new", "latest",
]);
const isFillerToken = (w: string) => /^\d+$/.test(w) || LABEL_FILLER.has(w);

/**
 * A topic key's own label terms for the cluster header (e.g. "big data").
 * Bigrams first, then unigrams — but: drop bigrams/unigrams that are pure
 * numerals or listicle filler ("top 11", "most"), and DEDUPE overlapping terms
 * so "top 11 · 11 demand · demand denmark" collapses to "demand · denmark".
 */
export function topicLabel(key: TopicKey, max = 3): string {
  const bigrams = key.bigrams.filter((b) => b.split(" ").every((w) => !isFillerToken(w)));
  const unigrams = key.unigrams.filter((u) => !isFillerToken(u));
  const used = new Set<string>();
  const out: string[] = [];
  for (const b of bigrams) {
    if (out.length >= max) break;
    const words = b.split(" ");
    if (words.every((w) => used.has(w))) continue; // fully covered already
    out.push(b);
    words.forEach((w) => used.add(w));
  }
  for (const u of unigrams) {
    if (out.length >= max) break;
    if (used.has(u)) continue;
    out.push(u);
    used.add(u);
  }
  // Fallbacks so a label is never empty (all-numeral/filler topics).
  return (
    out.join(" · ") ||
    key.bigrams.slice(0, max).join(" · ") ||
    key.unigrams.slice(0, max).join(" · ")
  );
}

/**
 * Build a label from a frequency-RANKED list of terms (most common first),
 * dropping numerals/filler and deduping overlaps. Used for cluster labels
 * computed from what MEMBERS share, so a seed-only token (a country in a
 * "skills in demand in {country}" series) doesn't dominate the label - the
 * shared "demand skills" wins over the seed's "demand denmark".
 */
export function labelFromTerms(rankedTerms: string[], max = 3): string {
  const used = new Set<string>();
  const picked: string[] = [];
  for (const term of rankedTerms) {
    if (picked.length >= max) break;
    const words = term.split(" ");
    if (words.some((w) => isFillerToken(w))) continue;
    if (words.every((w) => used.has(w))) continue;
    picked.push(term);
    words.forEach((w) => used.add(w));
  }
  // Drop a term whose words are a subset of another picked term ("companies"
  // when "companies japan" is also picked -> keep only the more specific one),
  // so labels don't read "companies · companies japan".
  const final = picked.filter((term) => {
    const w = term.split(" ");
    return !picked.some((o) => o !== term && w.every((x) => o.split(" ").includes(x)));
  });
  return final.join(" · ");
}
