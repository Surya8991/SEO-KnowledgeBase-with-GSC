import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getChat } from "@/lib/ai";
import { fetchAndExtract } from "@/lib/extract";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { SsrfBlockedError } from "@/lib/ssrf-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/summarize
 *
 * Audit S3 (Session 6): formerly unauthenticated and unrate-limited, which
 * combined with the URL fetcher made it a free SSRF probe + LLM-billing burner.
 * Gated through the shared `gateLlmEndpoint` (WEBHOOK_API_KEY OR per-IP rate
 * limit). SSRF surface closed in `lib/extract.ts → fetchAndExtract`.
 */
const BodySchema = z.object({
  input: z.string().trim().min(1).max(8000),
});

export async function POST(request: NextRequest) {
  const gate = await gateLlmEndpoint(request, "summarize");
  if (gate) return gate;
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const input = parsed.data.input;
    const isUrl = /^https?:\/\//i.test(input);
    const chat = getChat();
    if (isUrl) {
      const page = await fetchAndExtract(input);
      const result = await chat.summarize({
        title: page.title ?? undefined,
        content: [page.title, page.h1, page.contentText].filter(Boolean).join("\n"),
        isTopic: false,
      });
      return NextResponse.json({ inputType: "url", title: page.title, ...result });
    }
    const result = await chat.summarize({ content: input, isTopic: true });
    return NextResponse.json({ inputType: "topic", ...result });
  } catch (e) {
    if (e instanceof SsrfBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (e as Error).message || "Summarize failed." },
      { status: 500 },
    );
  }
}
