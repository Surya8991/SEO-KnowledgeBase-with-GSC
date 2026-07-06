# Conflict Types

The verdict the checker assigns to each match. Threshold values live in [`lib/score.ts`](../lib/score.ts) — if you change them, update this table in the same commit.

| Type | Blended score | Meaning | Typical action |
|------|---------------|---------|----------------|
| **`duplicate`** | ≥ 80 | The candidate and the matched page cover essentially the same topic with the same intent. Publishing both would split or cannibalize traffic with no incremental value. | Don't publish. Merge into / refresh the existing page. |
| **`cannibalization`** | 60 – 79 | Substantial topical overlap and overlapping target query. Both could rank for the same SERP slot and compete with each other. | Re-scope the candidate to a different angle, or consolidate. |
| **`partial-overlap`** | 35 – 59 | Some shared subtopics, but the dominant intents differ. Internal-linking opportunity rather than a conflict. | Publish, but link from/to the existing page; tighten the candidate's focus to avoid drift. |
| **`none`** | < 35 | Topically adjacent at best. Safe to publish. | Publish. |
| **`needs-review`** | n/a (no LLM verdict yet) | The page was returned by the vector search but fell outside the `classifyLimit` window (default top 15), so only a similarity-derived score is shown. | Click **Classify** in the UI (or call `/api/check/classify-one`) to get a verdict. |

## Why a blended score, not raw LLM?

Vector similarity is a measured, reproducible signal. The LLM verdict is sharper on intent but can hallucinate. We blend **`0.6 * base + 0.4 * llm`** (base-heavy as of Session 8 — was `0.4 * base + 0.6 * llm` before the audit) so a wild LLM number can't drift more than ~40 points from what the embeddings say. See [`blendScore`](../lib/score.ts).

## Why the 0.55 – 0.95 similarity band?

Sentence-embedding cosines for unrelated pages cluster around 0.30 – 0.55 in this corpus. Mapping the meaningful band `[0.55, 0.95]` linearly onto `[0, 100]` keeps the score readable — a 50% score actually means "moderately related," not "noise."

## Why the 0.50 minimum-similarity floor?

Session 6 audit (H11) raised the default `minSimilarity` from 0.30 to 0.50 in [`lib/conflict.ts`](../lib/conflict.ts). The pre-audit default let pairs in the 0.30 – 0.55 noise band reach the LLM classifier, where the LLM's 60% weight could lift a noise pair to a ~35 "partial-overlap" verdict — visible in the UI but indistinguishable from chance. The 0.50 floor keeps the surfaced results above the documented noise band.

To re-loosen without a redeploy, set `CONFLICT_MIN_SIMILARITY` in the environment (any value `0 < x < 1`).

## What the checker does NOT detect

- **Keyword overlap alone** (the score is semantic, not lexical — two pages can share keywords without conflicting and vice versa).
- **Outdated content** — freshness is a separate concern; see PROJECTLOG entries on the audit/re-ingest pipeline.
- **Trainer / scheduling conflicts** — wrong tool. Despite the name, this checker is about *content* conflicts.
