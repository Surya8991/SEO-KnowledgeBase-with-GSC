import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  vector,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Embedding dimension. Local model (bge-small-en-v1.5) = 384.
// When switching to OpenAI text-embedding-3-small (1536), run the documented
// re-embed migration that recreates this column at the new dimension.
export const EMBED_DIM = 384;

/** The existing-content corpus we compare new content against. */
export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    h1: text("h1"),
    contentText: text("content_text"),
    // course | blog | category | subcategory | page
    contentType: text("content_type").default("page"),
    // Audit H9 (Session 6): these columns exist in DB since
    // drizzle/0001_tags.sql but were missing from the TS schema. Added so
    // scripts/ingest.ts INSERTs typecheck against the schema again.
    courseType: text("course_type"),
    tags: text("tags").array(),
    category: text("category"),
    subcategory: text("subcategory"),
    lastmod: text("lastmod"),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    tokenCount: integer("token_count"),
    crawledAt: timestamp("crawled_at"),
    createdAt: timestamp("created_at").defaultNow(),
    // Added in 0004_seo_columns.sql — SEO-features sprint.
    ownerUrl: text("owner_url"),
    gscClicks28d: integer("gsc_clicks_28d"),
    gscImpressions28d: integer("gsc_impressions_28d"),
    gscPosition28d: real("gsc_position_28d"),
    gscSyncedAt: timestamp("gsc_synced_at"),
    canonicalUrl: text("canonical_url"),
    imageCount: integer("image_count"),
    imagesNoAlt: integer("images_no_alt"),
    isStale: boolean("is_stale").default(false),
    staleReason: text("stale_reason"),
  },
  (t) => [
    uniqueIndex("pages_url_idx").on(t.url),
    index("pages_content_type_idx").on(t.contentType),
    // Cosine-distance ANN index. Created in the migration via raw SQL too.
    index("pages_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/** One conflict-check run (URL or topic input). */
export const checks = pgTable("checks", {
  id: serial("id").primaryKey(),
  inputType: text("input_type").notNull(), // url | topic
  inputValue: text("input_value").notNull(),
  summary: text("summary"),
  keywords: text("keywords"), // JSON array string
  candidateEmbedding: vector("candidate_embedding", { dimensions: EMBED_DIM }),
  topScore: real("top_score"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  // Added in 0004_seo_columns.sql — shipped/blocked reporting.
  verdict: text("verdict"),
  outcome: text("outcome"),
  resolvedAt: timestamp("resolved_at"),
});

/** Per-check ranked matches against the corpus. */
export const checkMatches = pgTable(
  "check_matches",
  {
    id: serial("id").primaryKey(),
    checkId: integer("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    pageId: integer("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    pageUrl: text("page_url"),
    pageTitle: text("page_title"),
    similarity: real("similarity"), // cosine 0..1
    conflictScore: integer("conflict_score"), // 0..100
    conflictType: text("conflict_type"), // duplicate | cannibalization | partial-overlap | none
    rationale: text("rationale"),
    rank: integer("rank"),
    // Audit H8 (Session 6) — added in drizzle/0005_check_match_enrichment.sql.
    overlap: text("overlap").array(),
    issue: text("issue"),
    ownerUrl: text("owner_url"),
    gscClicks28d: integer("gsc_clicks_28d"),
  },
  (t) => [
    index("check_matches_check_idx").on(t.checkId),
    index("check_matches_owner_url_idx").on(t.ownerUrl),
  ],
);

/** Stored Google Search Console OAuth tokens. */
export const gscConnections = pgTable("gsc_connections", {
  id: serial("id").primaryKey(),
  userEmail: text("user_email"),
  siteUrl: text("site_url"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiry: timestamp("expiry"),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Cached GSC Search Analytics rows. */
export const gscMetrics = pgTable(
  "gsc_metrics",
  {
    id: serial("id").primaryKey(),
    siteUrl: text("site_url"),
    page: text("page"),
    query: text("query"),
    clicks: real("clicks"),
    impressions: real("impressions"),
    ctr: real("ctr"),
    position: real("position"),
    date: text("date"),
    rangeLabel: text("range_label"),
    fetchedAt: timestamp("fetched_at").defaultNow(),
  },
  (t) => [index("gsc_metrics_date_page_idx").on(t.date, t.page)],
);

/** Precomputed near-duplicate page pairs across the corpus. */
export const catalogConflicts = pgTable(
  "catalog_conflicts",
  {
    id: serial("id").primaryKey(),
    aId: integer("a_id"),
    aUrl: text("a_url"),
    aTitle: text("a_title"),
    aType: text("a_type"),
    bId: integer("b_id"),
    bUrl: text("b_url"),
    bTitle: text("b_title"),
    bType: text("b_type"),
    similarity: real("similarity"),
    pairType: text("pair_type"),
    computedAt: timestamp("computed_at").defaultNow(),
  },
  (t) => [index("catalog_conflicts_sim_idx").on(t.similarity)],
);

/** Competitor research results per topic. */
export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  topic: text("topic").notNull(),
  competitorUrl: text("competitor_url"),
  title: text("title"),
  summary: text("summary"),
  domain: text("domain"),
  estAuthority: text("est_authority"),
  isKnownCompetitor: integer("is_known_competitor").default(0),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Pre-generated draft library (Batch 15). Populated by
 *  scripts/pregen-drafts.ts on the operator's laptop using Antigravity
 *  (Gemini) or Claude Code. /api/drafts does vector search here at
 *  runtime; on cache miss the runtime path calls Groq and writes the
 *  result back, so the library grows itself. */
export const pregeneratedDrafts = pgTable(
  "pregenerated_drafts",
  {
    id: serial("id").primaryKey(),
    topic: text("topic").notNull(),
    sourceUrl: text("source_url"),
    draftMd: text("draft_md").notNull(),
    embedding: vector("embedding", { dimensions: EMBED_DIM }).notNull(),
    model: text("model").notNull(),
    contextHash: text("context_hash"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("pregenerated_drafts_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("pregenerated_drafts_source_url_idx").on(t.sourceUrl),
  ],
);

/** AI-generated content drafts (Batch 11). Queue + storage for the
 *  local-Claude pipeline. Web UI inserts queued rows; scripts/draft-worker.ts
 *  polls, generates via Claude Code locally, PATCHes the markdown back. */
export const drafts = pgTable("drafts", {
  id: serial("id").primaryKey(),
  checkId: integer("check_id").references(() => checks.id, { onDelete: "set null" }),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  briefMd: text("brief_md").notNull(),
  draftMd: text("draft_md"),
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  error: text("error"),
  requestedBy: text("requested_by"),
  requestedAt: timestamp("requested_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type Check = typeof checks.$inferSelect;
export type CheckMatch = typeof checkMatches.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
export type PregeneratedDraft = typeof pregeneratedDrafts.$inferSelect;
export type NewPregeneratedDraft = typeof pregeneratedDrafts.$inferInsert;
