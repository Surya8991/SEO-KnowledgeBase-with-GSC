import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildInsights } from "@/lib/gsc-insights";
import type { RangeKey } from "@/lib/gsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID: RangeKey[] = ["24h", "7d", "28d", "3m", "6m", "12m", "custom"];

const BodySchema = z.object({
  range: z.enum(VALID as [RangeKey, ...RangeKey[]]).default("28d"),
  // When range === "custom" the two fields below are required.
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD")
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { range, startDate, endDate } = parsed.data;
    if (range === "custom" && (!startDate || !endDate)) {
      return NextResponse.json(
        { error: "Custom range requires both startDate and endDate (YYYY-MM-DD)." },
        { status: 400 },
      );
    }
    const insights = await buildInsights(
      range,
      range === "custom" ? { startDate, endDate } : undefined,
    );
    return NextResponse.json(insights);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "GSC query failed." },
      { status: 500 },
    );
  }
}
