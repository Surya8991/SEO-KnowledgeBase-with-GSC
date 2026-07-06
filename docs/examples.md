# Worked Examples

Each example shows the input, what the pipeline returns, and how to read the verdict.

## 1. Clean topic — no conflict

**Input (topic):** `"how to introduce psychological safety in distributed engineering teams"`

**Top match:** existing blog "Building trust on remote teams" — similarity `0.41`, base score `0` (below 0.55 floor), no LLM verdict (filtered before classify).

**Verdict:** No matches above the 0.30 floor → `topScore = 0`. Safe to publish.

## 2. Duplicate

**Input (URL):** a draft blog "AWS Solutions Architect Associate — Complete Guide"

**Top match:** existing course page `/courses/aws-solutions-architect-associate-saa-c03` — similarity `0.91`, base `90`, LLM `94`, blended **`92` → `duplicate`**.

**Verdict:** Don't publish. The course page already owns this query; a new blog will cannibalize and split rank.

## 3. Cannibalization

**Input (URL):** draft blog "Top 10 Cybersecurity Certifications for 2026"

**Top matches:**
- `/blog/best-cybersecurity-certifications` — sim `0.84`, blended **`72` → `cannibalization`**
- `/blog/cissp-vs-ceh-which-cert-is-better` — sim `0.72`, blended **`55` → `partial-overlap`**

**Verdict:** Re-scope the candidate (e.g. narrow to "for career-switchers" or "ranked by salary uplift") or merge into the existing top-10 post.

## 4. Partial-overlap (link, don't kill)

**Input (topic):** `"crucial conversations training for first-time managers"`

**Top match:** `/courses/crucial-conversations` — sim `0.68`, blended **`48` → `partial-overlap`**.

**Verdict:** Publish, but link the new piece to the course page (and vice versa from the course's "related" block). The intents are distinct (catalog vs. how-to-buy).

## 5. Needs-review (long tail)

**Input (topic):** `"how to run an effective retrospective"`

**Vector search** returns 47 matches above 0.30. Top 15 are LLM-judged; matches 16–47 ship with `conflict_type = "needs-review"` and similarity-derived scores.

**Verdict:** Headline call returns immediately. UI lets the editor click any `needs-review` row → `POST /api/check/classify-one` → row updates in place with a full verdict.

## 6. URL vs topic — what changes

| Aspect | URL input | Topic input |
|--------|-----------|-------------|
| Source text | `fetchAndExtract(url)` → title + h1 + body | Raw topic string |
| `excludeUrl` in vector search | The input URL itself (don't match yourself) | n/a |
| `primaryQuery` | LLM infers from the page | LLM infers from the topic |

## 7. Reading the UI

- **Score colour** — red ≥80, orange ≥60, amber ≥35, green <35. Defined in [`scoreColor()`](../lib/score.ts).
- **Overlap chips** — 2–4 short phrases the LLM says both pages cover. Hover for context.
- **Issue line** — one-sentence plain-English SEO problem (e.g. "Both pages target the query 'AWS SAA certification cost'").
- **Show/Hide per-match summary** — collapsed by default to keep the list scannable.
