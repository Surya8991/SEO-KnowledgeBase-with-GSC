/**
 * Deterministic search-intent classifier (plans/01-conflict-automation.md,
 * Stage 5). Runs per page from its own text — a classifier, not a comparison.
 *
 * Intent is what a page is FOR, distinct from funnel stage
 * (lib/score-bands.ts intentStage → TOFU/MOFU/BOFU) and from content_type
 * (the page template). Rule-based only: keyword cues first, then a
 * content_type fallback. No LLM — keeps the decision path reproducible.
 */

export type Intent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

interface CueRule {
  intent: Intent;
  /** Whole-phrase cues matched against the combined lowercased text. */
  cues: string[];
}

// Order matters: the most commercially-committed intent that matches wins,
// so transactional/navigational cues are checked before commercial/info.
const CUE_RULES: CueRule[] = [
  {
    intent: "transactional",
    cues: [
      "buy", "pricing", "price", "book a demo", "request a demo", "demo",
      "sign up", "signup", "enquire", "enquiry", "get a quote", "quote",
      "get started", "subscribe", "checkout", "purchase", "hire",
    ],
  },
  {
    intent: "navigational",
    cues: [
      "login", "log in", "sign in", "contact", "about us", "about our",
      "careers", "faq", "faqs", "how it works", "dashboard", "account",
    ],
  },
  {
    intent: "commercial",
    cues: [
      "best", "top", "vs", "versus", "review", "reviews", "comparison",
      "compare", "alternatives", "solutions", "services", "software",
      "consulting", "for organizations", "for enterprises", "platform",
    ],
  },
  {
    intent: "informational",
    cues: [
      "how to", "what is", "what are", "why", "guide", "tutorial",
      "examples", "tips", "checklist", "template", "framework", "learn",
      "introduction", "meaning", "definition", "benefits",
    ],
  },
];

// Fallback when no keyword cue fires — the page's content_type is a decent
// structural prior.
const CONTENT_TYPE_INTENT: Record<string, Intent> = {
  course: "transactional",
  "managed-training": "transactional",
  platform: "transactional",
  consulting: "commercial",
  category: "commercial",
  subcategory: "commercial",
  "excellence-program": "commercial",
  templates: "informational",
  blog: "informational",
  static: "navigational",
};

/** Whole-word/phrase cue match against an already-normalised (spaces-only)
 *  haystack. Escapes regex metachars; `\b` boundaries stop substring hits. */
function cueMatches(haystack: string, cue: string): boolean {
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

export interface IntentInput {
  title?: string | null;
  h1?: string | null;
  slug?: string | null;
  text?: string | null;
  contentType?: string | null;
}

export interface IntentResult {
  label: Intent;
  /** Which cues (or the content_type fallback) drove the label — for "why". */
  cues: string[];
}

/**
 * Classify a page's search intent from its own signals. Deterministic:
 * keyword cues win; otherwise the content_type prior; else "informational".
 */
export function classifyIntent(input: IntentInput): IntentResult {
  // Normalise hyphens/underscores/slashes to spaces so slug cues like
  // "how-it-works" match phrase cues like "how it works".
  const haystack = [input.title, input.h1, input.slug, input.text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");

  for (const rule of CUE_RULES) {
    // Whole-word / whole-phrase match so short cues ("vs", "hire", "demo")
    // don't fire inside longer words ("tvs", "hired", "democracy").
    const hits = rule.cues.filter((c) => cueMatches(haystack, c));
    if (hits.length > 0) return { label: rule.intent, cues: hits };
  }

  const ct = (input.contentType ?? "").toLowerCase();
  if (ct && CONTENT_TYPE_INTENT[ct]) {
    return { label: CONTENT_TYPE_INTENT[ct], cues: [`type:${ct}`] };
  }

  return { label: "informational", cues: [] };
}
