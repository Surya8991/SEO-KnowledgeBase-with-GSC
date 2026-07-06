import { NextRequest, NextResponse } from "next/server";
import { serpOverlap } from "@/lib/competitors-extra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const topic = (body.topic ?? "").toString().trim();
    if (!topic) return NextResponse.json({ error: "Missing 'topic'." }, { status: 400 });
    const data = await serpOverlap(topic);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
