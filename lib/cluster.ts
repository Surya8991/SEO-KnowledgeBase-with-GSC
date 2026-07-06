/**
 * Connected-components clustering (plans/01-conflict-automation.md, Stage 6).
 *
 * The corpus scan (scripts/catalog-conflicts.ts) emits near-duplicate PAIRS.
 * A topic cluster is a connected component of that graph: page A links B, B
 * links C ⇒ {A,B,C} is one group even if A↔C was never directly compared.
 *
 * Pure + deterministic (union-find with path compression). Unit-tested.
 */

import { jaccard, tokenize, slugOverlap } from "@/lib/signals";
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
 * Multi-signal edge evidence (Stage 6 precision rules, PROJECTLOG 15G + 15H —
 * measured against the live corpus).
 *
 * An edge must NEVER rest on one signal:
 *  - Body cosine alone is not enough below the self-sufficient bar — course &
 *    static template boilerplate inflates it (/enquiry-form ↔ /contact-us
 *    measured 88% body, zero lexical overlap).
 *  - Same title/URL alone is not enough — the type-aware body floor always
 *    applies.
 *
 * Rules:
 *  1. Cross-type pairs never group (bleed → Catalog Conflicts page).
 *  2. Body ≥ type-aware floor: course↔course needs groupSimCourse, or
 *     groupSimCourseTitle + title Jaccard ≥ groupTitleJaccardCourse
 *     (Express.js vs Node.js: body 0.74 / title 0.5 → never groups);
 *     other same-type pairs need groupSimilarity.
 *  3. Corroboration: ≥1 of title/H1/description/slug at plural-normalized
 *     Jaccard ≥ groupSupportJaccard — unless body ≥ groupBodySelfSufficient
 *     (near-verbatim duplicate).
 */
export function evaluatePair(p: CandidatePair, t: Thresholds = THRESHOLDS): PairEvidence {
  const none: PairEvidence = { group: false, support: [] };
  if (!p.aType || p.aType !== p.bType) return none;

  // Lexical corroboration signals (computed once; also drive UI evidence tags).
  const support: EvidenceSignal[] = [];
  if (jaccard(supportTokens(p.aTitle), supportTokens(p.bTitle)) >= t.groupSupportJaccard) support.push("title");
  if (jaccard(supportTokens(p.aH1), supportTokens(p.bH1)) >= t.groupSupportJaccard) support.push("h1");
  if (jaccard(supportTokens(p.aDescription), supportTokens(p.bDescription)) >= t.groupSupportJaccard) support.push("description");
  if (slugOverlap(p.aUrl, p.bUrl) >= t.groupSupportJaccard) support.push("url");

  // Type-aware body floor.
  let bodyOk: boolean;
  if (p.aType === "course") {
    bodyOk =
      p.sim >= t.groupSimCourse ||
      (p.sim >= t.groupSimCourseTitle &&
        jaccard(tokenize(p.aTitle), tokenize(p.bTitle)) >= t.groupTitleJaccardCourse);
  } else {
    bodyOk = p.sim >= t.groupSimilarity;
  }
  if (!bodyOk) return { group: false, support };

  // Corroboration: lexical support, or near-verbatim body.
  const group = p.sim >= t.groupBodySelfSufficient || support.length >= 1;
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
