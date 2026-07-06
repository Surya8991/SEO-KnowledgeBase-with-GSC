import type { EmbeddingProvider } from "./types";

/**
 * OpenAI embeddings adapter.
 *
 * Inert until OPENAI_API_KEY is set. Wired so switching
 * AI_EMBED_PROVIDER=openai works with no business-logic changes.
 * Note: 1536 dims — requires the documented re-embed migration to widen
 * pages.embedding from 384 to 1536.
 *
 * Audit 10C (Session 8) — production hardening:
 *   - Chunked into ≤BATCH_MAX requests so we never hit OpenAI's 2,048-
 *     input-per-call cap. Bulk ingest at 2.5k+ pages used to crash with
 *     a 400 the moment the array got too big.
 *   - Exponential backoff with jitter on 429 / 5xx, up to MAX_RETRIES.
 *     OpenAI emits Retry-After on 429; we honour it when present.
 *   - Includes the truncated response body in the thrown error so
 *     debugging doesn't require opening the OpenAI dashboard.
 */
const BATCH_MAX = 256;
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 500;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai:text-embedding-3-small";
  readonly dimensions = 1536;
  private model = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not set. Keep AI_EMBED_PROVIDER=local until you add a key.",
      );
    }

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_MAX) {
      const slice = texts.slice(i, i + BATCH_MAX).map((t) => t.slice(0, 8000));
      out.push(...(await this.embedBatch(slice, key)));
    }
    return out;
  }

  private async embedBatch(input: string[], key: string): Promise<number[][]> {
    let attempt = 0;
    let lastErr: Error | null = null;
    while (attempt <= MAX_RETRIES) {
      try {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model: this.model, input }),
        });
        if (res.ok) {
          const json = (await res.json()) as { data: { embedding: number[] }[] };
          return json.data.map((d) => d.embedding);
        }
        if (res.status === 429 || res.status >= 500) {
          const retryAfterHeader = res.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader
            ? Number(retryAfterHeader) * 1000
            : BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 250;
          attempt++;
          if (attempt > MAX_RETRIES) {
            const body = await res.text().catch(() => "");
            throw new Error(
              `OpenAI embeddings ${res.status} after ${MAX_RETRIES} retries: ${body.slice(0, 500)}`,
            );
          }
          await sleep(retryAfterMs);
          continue;
        }
        // 4xx that isn't 429 — don't retry; surface body for debugging.
        const body = await res.text().catch(() => "");
        throw new Error(
          `OpenAI embeddings ${res.status} ${res.statusText} ${body.slice(0, 500)}`,
        );
      } catch (err) {
        lastErr = err as Error;
        // Network-level error: retry too.
        attempt++;
        if (attempt > MAX_RETRIES) break;
        await sleep(
          BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 250,
        );
      }
    }
    throw lastErr ?? new Error("OpenAI embeddings: unknown failure");
  }
}
