/**
 * Runtime draft resolver (Batch 17).
 *
 * Hot path executed by /api/drafts:
 *   1. Embed the input.
 *   2. findNearestDraft(embedding) — cosine top-1 in pregenerated_drafts.
 *   3. similarity >= 0.85 → return cached row instantly.
 *   4. similarity 0.65..0.85 → Groq ADAPT the cached draft to the new angle.
 *   5. similarity < 0.65 (or table empty) → Groq GENERATE fresh.
 *   6. In cases 4-5 the result is upserted into pregenerated_drafts so the
 *      next near-identical request becomes a cache hit.
 *
 * Groq model is llama-3.3-70b-versatile by default (GROQ_MODEL_DRAFT env
 * to override). Text-mode output — markdown straight to stdout.
 *
 * LLM_KILL_SWITCH disables Groq calls; cache hits still work, misses
 * raise an explicit "LLM_KILL_SWITCH active" error so the UI can label it.
 */
import Groq from "groq-sdk";
import { getEmbedder } from "@/lib/ai";
import { findNearestDraft, upsertDraft, type NearestDraft } from "@/lib/drafts/select";

const CACHE_HIT_THRESHOLD = 0.85;
const ADAPT_THRESHOLD = 0.65;
const GROQ_MODEL = process.env.GROQ_MODEL_DRAFT || "llama-3.3-70b-versatile";

export type DraftSource = "cached" | "groq-adapted" | "groq-fresh";

export interface ResolvedDraft {
  draftMd: string;
  source: DraftSource;
  similarity: number | null;
  model: string;
  sourceUrl: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

export interface ResolveOpts {
  /** Editorial context the LLM should respect — keywords, avoid-list,
   *  link targets, PAA questions. Plain markdown; stitched into the prompt. */
  context?: string;
  /** Skip cache lookup, force Groq to generate fresh. Used by the
   *  Regenerate button. */
  forceFresh?: boolean;
}

/**
 * Public entry. `topic` is the user-facing label (URL slug or topic
 * string) — what to write about. `embedding` is its 384-d vector so we
 * can vector-search the cache. The caller has already embedded the input
 * (avoids a redundant round-trip if /api/check already computed it).
 */
export async function resolveDraft(
  topic: string,
  embedding: number[],
  opts: ResolveOpts = {},
): Promise<ResolvedDraft> {
  const nearest = opts.forceFresh ? null : await findNearestDraft(embedding);

  // Case 1 — strong cache hit. Instant return, no LLM call.
  if (nearest && nearest.similarity >= CACHE_HIT_THRESHOLD && !opts.forceFresh) {
    return {
      draftMd: nearest.draftMd,
      source: "cached",
      similarity: nearest.similarity,
      model: nearest.model,
      sourceUrl: nearest.sourceUrl,
    };
  }

  // Cases 2 & 3 both need Groq. Honor LLM kill switch.
  if (process.env.LLM_KILL_SWITCH === "1") {
    throw new Error("LLM_KILL_SWITCH is active — Groq calls are disabled. Cache miss cannot be filled.");
  }

  const useAdapt = !!nearest && nearest.similarity >= ADAPT_THRESHOLD;
  const groqOutput = useAdapt
    ? await groqAdaptDraft(topic, nearest!, opts.context)
    : await groqFreshDraft(topic, opts.context);

  // Embed and cache the Groq output so the NEXT request for this topic
  // becomes a cache hit. source_url null because there's no editorial
  // owner page yet (this came from a user check, not the offline batch).
  const embedder = getEmbedder();
  const [vec] = await embedder.embed([groqOutput.text]);
  if (vec) {
    try {
      await upsertDraft({
        topic,
        sourceUrl: null,
        draftMd: groqOutput.text,
        embedding: vec,
        model: `groq:${GROQ_MODEL}`,
        tokensIn: groqOutput.tokensIn,
        tokensOut: groqOutput.tokensOut,
      });
    } catch (e) {
      // Don't fail the request if the cache write fails — log and continue.
      console.warn("[drafts/runtime] cache write failed:", (e as Error).message);
    }
  }

  return {
    draftMd: groqOutput.text,
    source: useAdapt ? "groq-adapted" : "groq-fresh",
    similarity: nearest?.similarity ?? null,
    model: `groq:${GROQ_MODEL}`,
    sourceUrl: nearest?.sourceUrl ?? null,
    tokensIn: groqOutput.tokensIn,
    tokensOut: groqOutput.tokensOut,
  };
}

function groq(): Groq {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set.");
  return new Groq({ apiKey: key });
}

const SYSTEM_PROMPT = [
  "You are an expert content writer for Edstellar, a corporate training platform.",
  "Audience: corporate L&D / HR / training managers at mid-to-large enterprises.",
  "",
  "Always return ONLY the article markdown — no preamble, no closing remarks, no \"Here is your article\".",
  "First line MUST be the H1 (`# Title`). Second line MUST be `> Meta: <description ≤155 chars>`.",
  "",
  "Required structure: H1 + meta line + 90-130 word intro + 4-7 H2 sections @ 200-400 words each (H3 subsections OK) + `## Frequently Asked Questions` with 4-6 questions @ 50-90 word answers + 80-120 word conclusion ending with a single specific next-step.",
  "",
  "Voice: expert, neutral, educational. Active voice. Average sentence ≤20 words.",
  "Ban: \"unlock\", \"empower\", \"revolutionize\", \"in today's\", \"game-changer\", \"fast-paced world\".",
  "",
  "Hard rules:",
  "- No invented statistics. Use only well-known industry benchmarks.",
  "- No fake quotes attributed to real people.",
  "- Do not mention competitor brand names.",
  "- The article must stand on its own — full value even if the reader visits nothing else.",
].join("\n");

async function groqFreshDraft(
  topic: string,
  context?: string,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const user = [
    `Topic: ${topic}`,
    "",
    "Write a 1500-2500 word blog post covering this topic for the audience above.",
    context ? "\nAdditional editorial context:\n" + context : "",
  ].join("\n");

  const res = await groq().chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.5,
    max_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });
  const text = (res.choices[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("Groq returned empty output");
  return {
    text,
    tokensIn: res.usage?.prompt_tokens ?? Math.round(user.length / 4),
    tokensOut: res.usage?.completion_tokens ?? Math.round(text.length / 4),
  };
}

async function groqAdaptDraft(
  topic: string,
  nearest: NearestDraft,
  context?: string,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const user = [
    `Topic: ${topic}`,
    "",
    `We already have a related article (cosine similarity ${nearest.similarity.toFixed(2)} to the new topic). It's close but not exact — adapt it into a NEW article for the topic above. Same structure and quality bar, but the angle, examples, and emphasis should fit the new topic, not the original.`,
    "",
    "Do not paraphrase the existing article line-by-line. Re-think it for the new topic.",
    "",
    "### Existing related article",
    "```",
    nearest.draftMd,
    "```",
    "",
    context ? "### Additional editorial context\n" + context : "",
  ].join("\n");

  const res = await groq().chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.5,
    max_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });
  const text = (res.choices[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("Groq returned empty output");
  return {
    text,
    tokensIn: res.usage?.prompt_tokens ?? Math.round(user.length / 4),
    tokensOut: res.usage?.completion_tokens ?? Math.round(text.length / 4),
  };
}
