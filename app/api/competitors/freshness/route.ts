import { NextRequest, NextResponse } from "next/server";
import { competitorFreshness } from "@/lib/competitors-extra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
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
