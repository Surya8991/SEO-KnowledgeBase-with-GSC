import type { EmbeddingProvider } from "./types";

// Lazy-loaded Transformers.js feature-extraction pipeline.
// bge-small-en-v1.5 → 384-dimensional sentence embeddings, runs in Node, no key.
let pipePromise: Promise<any> | null = null;

async function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Allow remote model download (cached under node_modules/.cache) on first run.
      env.allowLocalModels = false;
      return pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
    })();
  }
  return pipePromise;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local:bge-small-en-v1.5";
  readonly dimensions = 384;

  /**
   * Audit 10C (Session 8): the prior implementation used a serial
   * `for (const text of texts) await pipe(text, ...)` loop. xenova/
   * transformers actually supports passing an array directly — the
   * underlying ORT model batches in a single forward pass, dropping
   * wall-clock by ~Nx for bulk ingest. We keep one fallback to the
   * sequential path if the array form ever throws (older lib versions).
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await getPipe();
    const truncated = texts.map((t) => t.slice(0, 8000));
    try {
      const res = await pipe(truncated, {
        pooling: "mean",
        normalize: true,
      });
      // xenova returns either a single Tensor (one row) or a list of
      // Tensors (batched). `res.tolist()` is the universal accessor —
      // produces number[][] regardless of input shape.
      const list: number[][] = typeof res.tolist === "function"
        ? (res.tolist() as number[][])
        : [Array.from(res.data as Float32Array)];
      // Single-input batches sometimes come back un-wrapped — re-wrap.
      if (texts.length === 1 && Array.isArray(list) && typeof list[0] === "number") {
        return [list as unknown as number[]];
      }
      return list;
    } catch {
      // Fallback to the legacy per-text path so an SDK quirk doesn't
      // brick ingest.
      const out: number[][] = [];
      for (const text of truncated) {
        const r = await pipe(text, { pooling: "mean", normalize: true });
        out.push(Array.from(r.data as Float32Array));
      }
      return out;
    }
  }
}
