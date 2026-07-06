/**
 * Connected-components clustering (plans/01-conflict-automation.md, Stage 6).
 *
 * The corpus scan (scripts/catalog-conflicts.ts) emits near-duplicate PAIRS.
 * A topic cluster is a connected component of that graph: page A links B, B
 * links C ⇒ {A,B,C} is one group even if A↔C was never directly compared.
 *
 * Pure + deterministic (union-find with path compression). Unit-tested.
 */

import { jaccard, tokenize } from "@/lib/signals";
import { THRESHOLDS, type Thresholds } from "@/lib/thresholds";

/** A single similarity edge between two node ids (e.g. page URLs). */
export type Edge = readonly [string, string];

export interface CandidatePair {
  aType: string | null;
  bType: string | null;
  aTitle: string | null;
  bTitle: string | null;
  aH1?: string | null;
  bH1?: string | null;
  aDescription?: string | null;
  bDescription?: string | null;
  aUrl?: string | null;
  bUrl?: string | null;
  /** Body cosine similarity 0..1. */
  sim: number;
}

/** Lexical signals that can corroborate a cluster edge. */
export type EvidenceSignal = "title" | "h1" | "description" | "url" | "body";

export interface PairEvidence {
  group: boolean;
  /** Which signals support this edge (body listed when ≥ the type floor). */
  support: EvidenceSignal[];
}

/** Plural-normalized tokens for corroboration matching: "skill gaps" must
 *  match "skills gap" (measured false-negative in the live corpus). Both
 *  sides get the same normalization, so consistency is what matters. */
function supportTokens(text: string | null | undefined): string[] {
  return tokenize(text).map((tok) => (tok.length > 3 ? tok.replace(/s$/, "") : tok));
}

/**
 * Corpus-generic words that appear in almost every page's slug/title and so
 * carry NO topic signal. Without stripping these, "adobe-illustrator-training"
 * and "ai-for-ceos-training" anchor on the shared "training", and transitive
 * union-find chains the whole catalogue into one mega-cluster. Anchoring must
 * rest on DISTINCTIVE subject tokens (adobe/illustrator, big/data), so these
 * are removed before the topic-anchor Jaccard. Env-extend via
 * CONFLICT_TOPIC_STOPWORDS (comma-separated).
 */
const TOPIC_STOPWORDS = new Set<string>([
  "training", "course", "workshop", "certification", "certificate", "program",
  "programme", "masterclass", "bootcamp", "tutorial", "class", "classes", "lesson",
  "corporate", "enterprise", "online", "free", "professional", "instructor", "led",
  "for", "and", "the", "of", "in", "to", "with", "your", "our", "a", "an", "on", "at",
  "best", "top", "list", "guide", "company", "companie", "service", "example",
  "tip", "idea", "activitie", "activity", "game", "exercise", "employee", "team",
  "how", "what", "why", "when", "where", "vs", "using", "use",
  ...(process.env.CONFLICT_TOPIC_STOPWORDS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? []),
]);

/** Distinctive (stopword-filtered) subject tokens used for topic anchoring. */
function anchorTokens(text: string | null | undefined): string[] {
  return supportTokens(text).filter((t) => t.length > 2 && !TOPIC_STOPWORDS.has(t));
}

/**
 * Plural-normalized DISTINCTIVE tokens of the FINAL slug segment only — the
 * actual subject ("big-data-training" → {big,data}), not the shared path prefix
 * ("category"/"course") nor generic words ("training"). Using the whole path or
 * generic tokens lets unrelated same-type pages anchor on common words, which
 * is exactly the false-cluster bug this rewrite fixes.
 */
function lastSlugTokens(url: string | null | undefined): string[] {
  if (!url) return [];
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* not an absolute URL — treat the raw string as a path */
  }
  const seg = path.split("/").filter(Boolean).pop() ?? "";
  return anchorTokens(seg.replace(/[-_]+/g, " ").replace(/\.[a-z0-9]+$/i, ""));
}


/**
 * Topic-first edge evidence (rewritten — the tool groups pages about the SAME
 * TOPIC, regardless of page type).
 *
 * Why the rewrite: the previous logic gated on SAME content-type + body cosine.
 * On the live corpus that (a) blocked genuinely-related cross-type pairs — the
 * `/category/big-data-training` listing and the `/blog/big-data-training-companies`
 * article never grouped — while (b) lumping 40 UNRELATED same-type pages together,
 * because category/course template boilerplate pushes body cosine past the
 * "self-sufficient" bar with zero topic overlap.
 *
 * The subject of a page lives in its SLUG / TITLE / H1 tokens
 * ("big-data-training"), which are template-independent. Body cosine only tells
 * you two pages read similarly — which, for templated pages, is noise. So:
 *
 *  1. TOPIC ANCHOR (required): slug OR title OR H1 plural-normalized Jaccard
 *     ≥ groupTopicAnchor. This is what "same topic" means. Description is
 *     corroboration only (boilerplate CTAs), never an anchor.
 *  2. BODY RELATEDNESS (required): body cosine ≥ groupBodyFloor — guards
 *     against a coincidental token match between genuinely different pages.
 *     Deliberately low so a category listing and a blog on the same topic
 *     (different formats → moderate cosine) still group.
 *  3. Content TYPE does NOT gate — cross-type same-topic pairs are exactly what
 *     we want to surface. Template-heavy bodies can no longer group different
 *     topics because the topic anchor is mandatory.
 */
export function evaluatePair(p: CandidatePair, t: Thresholds = THRESHOLDS): PairEvidence {
  // Evidence tags for the UI use the full token sets (any overlap counts).
  const support: EvidenceSignal[] = [];
  if (jaccard(supportTokens(p.aTitle), supportTokens(p.bTitle)) >= t.groupSupportJaccard) support.push("title");
  if (jaccard(supportTokens(p.aH1), supportTokens(p.bH1)) >= t.groupSupportJaccard) support.push("h1");
  if (jaccard(supportTokens(p.aDescription), supportTokens(p.bDescription)) >= t.groupSupportJaccard) support.push("description");
  const slugJ = jaccard(lastSlugTokens(p.aUrl), lastSlugTokens(p.bUrl));
  if (slugJ >= t.groupSupportJaccard) support.push("url");

  // 1. Topic anchor — a SUBJECT-bearing signal (slug/title/H1) must strongly
  //    overlap on its DISTINCTIVE (stopword-filtered) tokens, using token-SET
  //    Jaccard. A single shared generic word ("training") scores low and never
  //    anchors. Description is not subject-bearing enough to anchor on its own.
  const titleAnchorJ = jaccard(anchorTokens(p.aTitle), anchorTokens(p.bTitle));
  const h1AnchorJ = jaccard(anchorTokens(p.aH1), anchorTokens(p.bH1));
  const hasTopicAnchor =
    slugJ >= t.groupTopicAnchor ||
    titleAnchorJ >= t.groupTopicAnchor ||
    h1AnchorJ >= t.groupTopicAnchor;

  // 2. Body relatedness floor (guards coincidental token matches).
  const bodyOk = p.sim >= t.groupBodyFloor;

  const group = hasTopicAnchor && bodyOk;
  return { group, support: group ? ["body", ...support] : support };
}

/** Back-compat boolean wrapper over evaluatePair. */
export function shouldGroupPair(p: CandidatePair, t: Thresholds = THRESHOLDS): boolean {
  return evaluatePair(p, t).group;
}

class UnionFind {
  private parent = new Map<string, string>();

  private find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    // Walk to the root.
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression: point every node on the path straight at the root.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  root(x: string): string {
    return this.find(x);
  }
}

/**
 * Group nodes into connected components from a list of edges. Returns each
 * component as a sorted array of node ids; singletons (nodes with no edges)
 * are omitted unless passed in `extraNodes`. Components are sorted largest
 * first, then by first member for a stable order.
 */
export function connectedComponents(
  edges: Edge[],
  extraNodes: string[] = [],
): string[][] {
  const uf = new UnionFind();
  for (const [a, b] of edges) uf.union(a, b);
  for (const n of extraNodes) uf.add(n);

  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    for (const node of [a, b]) {
      if (seen.has(node)) continue;
      seen.add(node);
      const r = uf.root(node);
      const g = groups.get(r) ?? [];
      g.push(node);
      groups.set(r, g);
    }
  }
  for (const n of extraNodes) {
    if (seen.has(n)) continue;
    seen.add(n);
    const r = uf.root(n);
    const g = groups.get(r) ?? [];
    g.push(n);
    groups.set(r, g);
  }

  return [...groups.values()]
    .map((g) => g.slice().sort())
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}
