import { NextRequest, NextResponse } from "next/server";
import { domainCompare } from "@/lib/competitors-extra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const topics: string[] = Array.isArray(body.topics) ? body.topics : [];
    if (!topics.length) {
      return NextResponse.json({ error: "Missing 'topics[]'." }, { status: 400 });
    }
    const data = await domainCompare(topics);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
