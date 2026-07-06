export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ConflictMatchInput {
  url: string;
  title: string | null;
  snippet: string;
  similarity: number; // cosine 0..1
}

export interface ConflictVerdict {
  url: string;
  conflictScore: number; // 0..100
  conflictType: "duplicate" | "cannibalization" | "partial-overlap" | "none";
  /** One personalised sentence naming the conflicting page. */
  rationale: string;
  /** 2-4 short phrases (keywords / sub-topics / sections) that BOTH pages cover. */
  overlap?: string[];
  /** One blunt sentence on the SEO/UX problem (e.g. "splits ranking for X"). */
  issue?: string;
}

export interface SummaryResult {
  summary: string;
  keywords: string[];
  searchSynopsis: string; // dense text used for embedding/search
  /** The single 4-8 word SEO query this page targets — used for SERP lookups.
   *  Far more useful than keywords[0], which is usually too short/generic. */
  primaryQuery?: string;
}

/** Input to `proposeRewrite` — a draft + the conflicting existing pages. */
export interface RewriteProposalInput {
  /** The draft / topic / URL the user is planning to publish. */
  input: string;
  /** Optional summary of the draft if /api/summarize already ran. */
  summary?: string;
  /** Top conflicting pages (capped at 5 by the route). */
  conflicts: { title: string; url: string; rationale?: string }[];
  /**
   * Audit 10C (Session 8): SERP-feature hints from /api/competitors/serp-overlap
   * — used so the LLM knows what featured-snippet / AI-Overview shape the
   * SERP rewards before suggesting angles. All fields optional; pass what
   * you have.
   */
  serpHints?: {
    /** Google AI Overview summary (if present on the SERP). */
    aiOverviewSummary?: string;
    /** "People also ask" questions surfaced for this query. */
    peopleAlsoAsk?: string[];
    /** Featured-snippet / answer box snippet. */
    answerBox?: string;
  };
}

export interface RewriteAngle {
  angle: string;
  audience: string;
  primaryKeyword: string;
}

/** Audit S6 (Session 6): proper structured output for /api/rewrite-suggestion. */
export interface RewriteProposal {
  diagnosis: string;
  angles: RewriteAngle[];
  decision: "rewrite" | "merge" | "skip";
}

export interface ChatProvider {
  readonly name: string;
  /** Raw chat completion for prompts that don't fit the summarize/classify
   *  specialisations — e.g. generating content angles, rewrite suggestions.
   *  Providers run in JSON-mode at the adapter level, so the returned string
   *  is typically a JSON object the caller parses itself. */
  generate(input: { system: string; prompt: string }): Promise<string>;
  /** Summarize a URL/topic's content and extract keywords + a search synopsis. */
  summarize(input: {
    title?: string;
    content: string;
    isTopic: boolean;
  }): Promise<SummaryResult>;
  /** Judge candidate vs. the shortlisted existing pages, returning per-page verdicts. */
  classifyConflicts(input: {
    candidateSummary: string;
    matches: ConflictMatchInput[];
  }): Promise<ConflictVerdict[]>;
  /** Summarize a competitor page for the research view. */
  summarizeCompetitor(input: {
    topic: string;
    url: string;
    title?: string;
    content: string;
  }): Promise<{ summary: string; angle: string }>;
  /** Audit S6 (Session 6): structured-output rewrite plan for a draft that
   *  collides with existing pages. Replaces the prior misuse of summarize(). */
  proposeRewrite(input: RewriteProposalInput): Promise<RewriteProposal>;
}
