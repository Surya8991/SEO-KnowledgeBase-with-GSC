/**
 * Cache lookup for the pre-generated draft library (Batch 15).
 *
 * Hot path is dead simple:
 *   - Embed the user's input (URL slug or topic text).
 *   - Cosine-nearest row in `pregenerated_drafts`.
 *   - Caller decides: similarity >= 0.85 → return cached; lower → fall
 *     back to Groq (lib/drafts/runtime.ts).
 *
 * Mirrors lib/search.ts vectorSearchPages, but smaller surface — we
 * only ever need the top match for drafts.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/exec";
import { toVectorLiteral } from "@/lib/search";

export interface NearestDraft {
  id: number;
  topic: string;
  sourceUrl: string | null;
  draftMd: string;
  model: string;
  similarity: number;
  generatedAt: string;
}

interface NearestDraftRow {
  id: number;
  topic: string;
  source_url: string | null;
  draft_md: string;
  model: string;
  similarity: number;
  generated_at: string;
}

/**
 * Return the nearest cached draft to a query embedding, or null if the
 * table is empty. Caller decides the threshold — we don't filter here
 * because cache-near-miss is still useful as input to Groq's "adapt
 * this draft" prompt.
 */
export async function findNearestDraft(
  embedding: number[],
): Promise<NearestDraft | null> {
  const vec = toVectorLiteral(embedding);
  const rows = await db.execute(sql`
    SELECT id, topic, source_url, draft_md, model,
           generated_at,
           1 - (embedding <=> ${vec}::vector) AS similarity
    FROM pregenerated_drafts
    ORDER BY embedding <=> ${vec}::vector
    LIMIT 1
  `);
  const arr = rowsOf<NearestDraftRow>(rows);
  if (arr.length === 0) return null;
  const r = arr[0]!;
  return {
    id: Number(r.id),
    topic: r.topic,
    sourceUrl: r.source_url,
    draftMd: r.draft_md,
    model: r.model,
    similarity: Number(r.similarity),
    generatedAt: r.generated_at,
  };
}

/**
 * Insert (or update by source_url) a draft into the cache. Used by both
 * the offline pregen script and the runtime Groq fallback (which caches
 * its output so the next near-identical request becomes a cache hit).
 */
export async function upsertDraft(input: {
  topic: string;
  sourceUrl?: string | null;
  draftMd: string;
  embedding: number[];
  model: string;
  contextHash?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}): Promise<number> {
  const vec = toVectorLiteral(input.embedding);
  // ON CONFLICT only triggers when source_url is set (the partial unique
  // index in 0007_pregenerated_drafts.sql). Rows with null source_url
  // (runtime Groq output) always insert fresh; over time the highest-
  // similarity ones win the lookup so duplicates self-prune.
  if (input.sourceUrl) {
    const rows = await db.execute(sql`
      INSERT INTO pregenerated_drafts
        (topic, source_url, draft_md, embedding, model, context_hash, tokens_in, tokens_out, generated_at, updated_at)
      VALUES
        (${input.topic}, ${input.sourceUrl}, ${input.draftMd}, ${vec}::vector,
         ${input.model}, ${input.contextHash ?? null}, ${input.tokensIn ?? null}, ${input.tokensOut ?? null},
         NOW(), NOW())
      ON CONFLICT (source_url) WHERE source_url IS NOT NULL DO UPDATE SET
        topic = EXCLUDED.topic,
        draft_md = EXCLUDED.draft_md,
        embedding = EXCLUDED.embedding,
        model = EXCLUDED.model,
        context_hash = EXCLUDED.context_hash,
        tokens_in = EXCLUDED.tokens_in,
        tokens_out = EXCLUDED.tokens_out,
        updated_at = NOW()
      RETURNING id
    `);
    return Number(rowsOf<{ id: number }>(rows)[0]!.id);
  }
  const rows = await db.execute(sql`
    INSERT INTO pregenerated_drafts
      (topic, draft_md, embedding, model, context_hash, tokens_in, tokens_out)
    VALUES
      (${input.topic}, ${input.draftMd}, ${vec}::vector,
       ${input.model}, ${input.contextHash ?? null},
       ${input.tokensIn ?? null}, ${input.tokensOut ?? null})
    RETURNING id
  `);
  return Number(rowsOf<{ id: number }>(rows)[0]!.id);
}
