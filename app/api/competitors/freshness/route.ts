import { NextRequest, NextResponse } from "next/server";
import { competitorFreshness } from "@/lib/competitors-extra";
import { gateLlmEndpoint } from "@/lib/api-gate";

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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
