import { NextRequest, NextResponse } from "next/server";
import { pageCannibalization } from "@/lib/gsc-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/check/cannibalization
 * Returns GSC cannibalization groups that include the given URL — surfaced
 * inline on the conflict-checker result. Auth is inherited from proxy.ts
 * (dashboard session) since this route is dashboard-only and the data is
 * already visible on /search-console.
 *
 * Body: { url: string, range?: "7d" | "28d" | "3m" | "6m" | "12m" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = (body.url ?? "").toString();
    if (!url) {
      return NextResponse.json({ groups: [], error: "Missing url." }, { status: 400 });
    }
    const range = (body.range ?? "28d") as any;
    const groups = await pageCannibalization(url, range);
    return NextResponse.json({ url, range, groups });
  } catch (e) {
    // GSC may be unconnected — return empty groups so the UI just hides the banner.
    return NextResponse.json(
      { groups: [], error: (e as Error).message },
      { status: 200 },
    );
  }
}
