import { describe, it, expect } from "vitest";
import { runIngestPool, type SitemapEntry } from "@/lib/ingest-page";

// Deps are never used because a past deadline stops the pool before any entry
// is pulled — so ingestOne (which needs DB + network) is never called.
const noopDeps = { sql: {} as never, embedder: {} as never };

describe("runIngestPool deadline (audit — resumable reingest)", () => {
  it("stops before processing any entry when the deadline has already passed", async () => {
    const entries: SitemapEntry[] = Array.from({ length: 100 }, (_, i) => ({
      url: `https://x/${i}`,
      lastmod: "2026-01-01",
    }));
    const res = await runIngestPool(entries, noopDeps, {
      concurrency: 4,
      deadlineMs: Date.now() - 1000, // already expired
    });
    expect(res.stopped).toBe(true);
    expect(res.done).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.failed).toBe(0);
  });

  it("reports not-stopped for an empty work list", async () => {
    const res = await runIngestPool([], noopDeps, { deadlineMs: Date.now() + 60_000 });
    expect(res.stopped).toBe(false);
    expect(res.done).toBe(0);
  });
});
