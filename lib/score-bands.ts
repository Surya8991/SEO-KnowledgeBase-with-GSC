/**
 * Audit 10C tokenization (Session 8): single source of truth for the
 * 0–100 conflict-score banding. Previously hard-coded in three places
 * (ui.tsx ScoreBar, app/(dashboard)/page.tsx scoreColor/scoreType,
 * conflict-checker/page.tsx MatchCard). Any future band change has to
 * update this file once instead of three at-risk-of-drift copies.
 *
 * Bands mirror lib/score.ts conflictTypeFromScore + scoreColor — those
 * functions return SCORE → semantic-name and SCORE → hex; this module
 * adds the Tailwind-color companions the UI needs.
 */
import { conflictTypeFromScore } from "./score";
import type { ConflictVerdict } from "./ai/types";

export type ScoreBand = "high" | "medium" | "low" | "none";

export const SCORE_BAND_THRESHOLDS = {
  high: 80,
  medium: 60,
  low: 35,
} as const;

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_BAND_THRESHOLDS.high) return "high";
  if (score >= SCORE_BAND_THRESHOLDS.medium) return "medium";
  if (score >= SCORE_BAND_THRESHOLDS.low) return "low";
  return "none";
}

/** Tailwind background-color class for solid fills (progress bar etc). */
export function scoreBarColor(score: number): string {
  switch (scoreBand(score)) {
    case "high":   return "bg-red-500";
    case "medium": return "bg-orange-500";
    case "low":    return "bg-amber-500";
    default:       return "bg-green-500";
  }
}

/** Tailwind text-color class for inline numbers / badges. */
export function scoreTextColor(score: number): string {
  switch (scoreBand(score)) {
    case "high":   return "text-red-700";
    case "medium": return "text-orange-700";
    case "low":    return "text-amber-700";
    default:       return "text-green-700";
  }
}

/** Re-export so callers can grab band + type in one import. */
export function scoreType(score: number): ConflictVerdict["conflictType"] {
  return conflictTypeFromScore(score);
}

export type IntentStage = "TOFU" | "MOFU" | "BOFU";

const INTENT_MAP: Record<string, IntentStage> = {
  blog:        "TOFU",
  topic:       "TOFU",
  category:    "MOFU",
  subcategory: "MOFU",
  course:      "BOFU",
  mentor:      "BOFU",
};

/** Map a content-type string to a funnel stage badge, or null if unknown. */
export function intentStage(contentType: string | null | undefined): IntentStage | null {
  if (!contentType) return null;
  return INTENT_MAP[contentType.toLowerCase()] ?? null;
}
