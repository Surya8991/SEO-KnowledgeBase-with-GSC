import { NextRequest, NextResponse } from "next/server";
import { pageDrilldown } from "@/lib/gsc-insights";
import type { RangeKey } from "@/lib/gsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const page = (body.page ?? "").toString();
    const range = (body.range ?? "28d") as RangeKey;
    if (!page) return NextResponse.json({ error: "Missing 'page'." }, { status: 400 });
    const data = await pageDrilldown(page, range);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
