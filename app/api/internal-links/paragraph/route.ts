import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEmbedder } from "@/lib/ai";
import { fetchAndExtract } from "@/lib/extract";
import { vectorSearchPages } from "@/lib/search";
import { clientIp, consume, denied } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * POST /api/internal-links/paragraph
 * Body: { input: string, perParagraph?: number, paragraphs?: string[] }
 *
 * Two input modes (#44):
 *   - input = URL    → fetch + split the body into paragraphs
 *   - input = text   → split on blank lines into paragraphs
 *   - paragraphs[]   → caller supplies them pre-split (highest priority)
 *
 * For each paragraph we embed and run a small vector search; returns the
 * top `perParagraph` (default 3) suggestions per paragraph. The same page
 * may surface for multiple paragraphs — the UI dedupes by anchor.
 *
 * Rate-limited per-IP (20 req/5min) because each call embeds N paragraphs.
 */
const BodySchema = z.object({
  input: z.string().trim().min(1).max(40_000).optional(),
  paragraphs: z.array(z.string().trim().min(20).max(2000)).optional(),
  perParagraph: z.coerce.number().int().min(1).max(8).optional(),
});

const MIN_PARAGRAPH_LEN = 80;

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+|\r\n\s*\r\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_PARAGRAPH_LEN);
}

export async function POST(request: NextRequest) {
  try {
    const required = process.env.WEBHOOK_API_KEY;
    if (required) {
      if (request.headers.get("x-api-key") !== required) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
    } else {
      const rl = await consume(clientIp(request), "internal-links-para", { max: 20, windowSec: 300 });
      if (!rl.ok) return denied(rl);
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body.", issues: parsed.error.issues }, { status: 400 });
    }
    const { input, paragraphs, perParagraph = 3 } = parsed.data;

    let paras: string[] = [];
    let sourceUrl: string | null = null;
    if (Array.isArray(paragraphs) && paragraphs.length) {
      paras = paragraphs;
    } else if (input && /^https?:\/\//i.test(input)) {
      const page = await fetchAndExtract(input);
      sourceUrl = input;
      // Body text was concatenated by the extractor — split on '. ' as a
      // weak proxy for paragraphs since whitespace is gone post-normalize.
      // Take 5-sentence groups.
      const sentences = page.contentText.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length);
      for (let i = 0; i < sentences.length; i += 5) {
        const chunk = sentences.slice(i, i + 5).join(" ");
        if (chunk.length >= MIN_PARAGRAPH_LEN) paras.push(chunk);
      }
    } else if (input) {
      paras = splitIntoParagraphs(input);
      if (paras.length === 0) paras = [input.trim()].filter((p) => p.length >= MIN_PARAGRAPH_LEN);
    } else {
      return NextResponse.json({ error: "Missing 'input' or 'paragraphs[]'." }, { status: 400 });
    }
    if (!paras.length) {
      return NextResponse.json({ error: "Input has no paragraphs long enough to suggest links for (min 80 chars)." }, { status: 400 });
    }
    if (paras.length > 40) paras = paras.slice(0, 40);

    const embedder = getEmbedder();
    const embeds = await embedder.embed(paras);

    const suggestions = await Promise.all(
      embeds.map(async (vec, idx) => {
        const matches = await vectorSearchPages(vec, {
          limit: perParagraph,
          excludeUrl: sourceUrl ?? "",
        });
        return {
          index: idx,
          preview: paras[idx]!.slice(0, 220) + (paras[idx]!.length > 220 ? "…" : ""),
          suggestions: matches.map((m, i) => ({
            rank: i + 1,
            url: m.url,
            title: m.title,
            similarity: m.similarity,
            anchor: m.title || m.url,
            contentType: m.contentType,
          })),
        };
      }),
    );

    return NextResponse.json({
      sourceUrl,
      paragraphCount: paras.length,
      suggestions,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
