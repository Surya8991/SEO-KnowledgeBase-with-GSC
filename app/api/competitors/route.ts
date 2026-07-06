import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { researchCompetitors } from "@/lib/competitors";
import { gateLlmEndpoint } from "@/lib/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// H5: strict Zod schema — topic unbounded + Number(limit) is an injection
// surface (e.g. limit=999 burning 999× Serper credits per call).
const BodySchema = z.object({
  topic: z.string().min(1, "topic is required").max(500),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export async function POST(request: NextRequest) {
  const gate = await gateLlmEndpoint(request, "competitors", { max: 10, windowSec: 60 });
  if (gate) return gate;
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
    }
    const { topic, limit } = parsed.data;
    const results = await researchCompetitors(topic, { limit });
    return NextResponse.json({ topic, results });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
