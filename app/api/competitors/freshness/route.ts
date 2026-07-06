import { NextRequest, NextResponse } from "next/server";
import { competitorFreshness } from "@/lib/competitors-extra";
import { gateLlmEndpoint } from "@/lib/api-gate";
import { errorResponse } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // H1: this endpoint fans out to remote sitemap + page fetches (SSRF-guarded
  // via safeFetch) — gate it like every other outbound-fetching route.
  const gate = await gateLlmEndpoint(request, "competitors-freshness", { max: 15, windowSec: 60 });
  if (gate) return gate;
  try {
    const body = await request.json().catch(() => ({}));
    const domain = (body.domain ?? "").toString().trim();
    if (!domain) return NextResponse.json({ error: "Missing 'domain'." }, { status: 400 });
    const data = await competitorFreshness(domain);
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse("/api/competitors/freshness", e, {
      status: 500,
      publicMessage: "Request failed.",
    });
  }
}
