import { NextRequest, NextResponse } from "next/server";
import { serpOverlap } from "@/lib/competitors-extra";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // H1: burns Serper credits per call — gate it (WEBHOOK_API_KEY or rate-limit).
  const gate = await gateLlmEndpoint(request, "serp-overlap", { max: 15, windowSec: 60 });
  if (gate) return gate;
  try {
    const body = await request.json().catch(() => ({}));
    const topic = (body.topic ?? "").toString().trim();
    if (!topic) return NextResponse.json({ error: "Missing 'topic'." }, { status: 400 });
    const data = await serpOverlap(topic);
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse("/api/competitors/serp-overlap", e, {
      status: 500,
      publicMessage: "Request failed.",
    });
  }
}
