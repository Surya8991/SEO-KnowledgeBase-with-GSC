/**
 * POST /api/rewrite-suggestion
 * Body: { input, conflicts: [{title, url, rationale}], summary? }
 *
 * Audit S6 (Session 6): the previous implementation abused chat.summarize()
 * to coax a {diagnosis,angles,decision} JSON shape out of the LLM, parsing
 * the result out of the `searchSynopsis` field. It worked maybe 10% of the
 * time. Now uses chat.proposeRewrite() — a structured-output method with
 * zod-validated schema, dedicated prompt, and prompt-injection delimiters.
 *
 * Auth/rate-limit: gateLlmEndpoint() — WEBHOOK_API_KEY OR per-IP rate-limit
 * (audit S3).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getChat } from "@/lib/ai";
import { gateLlmEndpoint } from "@/lib/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ConflictSchema = z.object({
  title: z.string().max(500).default(""),
  url: z.string().max(1000),
  rationale: z.string().max(2000).optional(),
});

const SerpHintsSchema = z.object({
  aiOverviewSummary: z.string().max(2000).optional(),
  peopleAlsoAsk: z.array(z.string().max(500)).max(10).optional(),
  answerBox: z.string().max(2000).optional(),
});

const BodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
  summary: z.string().max(2000).optional(),
  conflicts: z.array(ConflictSchema).max(20).default([]),
  serpHints: SerpHintsSchema.optional(),
});

export async function POST(request: NextRequest) {
  const gate = await gateLlmEndpoint(request, "rewrite-suggestion");
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
    const body = parsed.data;
    const chat = getChat();
    const proposal = await chat.proposeRewrite({
      input: body.input,
      summary: body.summary,
      conflicts: body.conflicts,
      serpHints: body.serpHints,
    });
    return NextResponse.json(proposal);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Rewrite suggestion failed." },
      { status: 500 },
    );
  }
}
