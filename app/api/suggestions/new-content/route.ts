/**
 * POST /api/suggestions/new-content
 * Body: { topic: string, url?: string }
 *
 * Returns 6 structured net-new content angles synthesised from:
 *   - competitor SERP titles for this topic (Serper)
 *   - LLM knowledge of AI Overviews, recent Google updates, AI assistants
 *
 * Used by the Conflict Checker "what should we publish instead?" panel.
 */
import { NextRequest, NextResponse } from "next/server";
import { serpOverlap } from "@/lib/competitors-extra";
import { getChat } from "@/lib/ai";
import { parseJson } from "@/lib/ai/chat-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `You are a senior SEO content strategist for Edstellar, a B2B corporate-training company.
Return ONLY compact JSON matching the requested schema. No preamble, no explanation, no markdown fences.
Every field has a strict word/char cap — respect it. Prefer concrete, specific phrasing over generic SEO clichés
("ultimate guide", "everything you need to know", "key insights" are banned).`;

interface Angle {
  title: string;
  format: "blog" | "guide" | "course" | "landing";
  audience: string;
  primaryKeyword: string;
  differentiation: string;
  trigger: "competitors" | "ai-overview" | "google-update" | "ai-platform" | "emerging-topic";
}
interface Suggestions {
  headline: string;
  angles: Angle[];
}

function buildPrompt(topic: string, url: string, competitorSnippets: string): string {
  return `TOPIC: ${topic}
${url ? `EXISTING URL: ${url}\n` : ""}
Top competitors currently ranking:
${competitorSnippets || "(no SERP data available — treat as greenfield)"}

Produce 6 NEW content angles Edstellar should publish that:
  • Don't repeat any competitor's framing above.
  • Address post-2024 shifts: AI Overviews, Google's helpful-content/EEAT/hidden-gems updates,
    and the rise of AI assistants (ChatGPT/Claude/Gemini/Perplexity) as discovery surfaces.
  • Are realistic for a B2B corporate-training brand to write authoritatively.

Return STRICT JSON, no other text:
{
  "headline": string,          // ≤14 words. ONE sentence stating the strategic opening.
                               //   Bad:  "The topic of skills gaps is a pressing concern…"
                               //   Good: "Competitors flood the SERP with generic checklists — own the AI-assisted variant instead."
  "angles": [                  // exactly 6 items
    {
      "title":           string,  // ≤9 words. Working headline. No "ultimate", "guide to", "everything", "complete".
      "format":          "blog" | "guide" | "course" | "landing",
      "audience":        string,  // ≤6 words. Role + seniority. e.g. "L&D leads at mid-market firms".
      "primaryKeyword":  string,  // 4-8 words. The exact SEO query this targets.
      "differentiation": string,  // ≤18 words. ONE concrete reason this beats the top-ranking competitor.
                                  //   Must reference a specific gap, not "more depth" / "better examples".
      "trigger":         "competitors" | "ai-overview" | "google-update" | "ai-platform" | "emerging-topic"
    }
  ]
}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const topic = (body.topic ?? "").toString().trim();
    const url = (body.url ?? "").toString().trim();
    if (!topic) return NextResponse.json({ error: "Missing 'topic'." }, { status: 400 });

    let serp: any = null;
    try { serp = await serpOverlap(topic) } catch (e) { serp = { error: (e as Error).message } }

    const competitorSnippets = (serp?.organic ?? [])
      .filter((r: any) => !r.isEdstellar)
      .slice(0, 8)
      .map((r: any) => `- ${r.title} (${r.domain})`)
      .join("\n");

    const raw = await getChat().generate({
      system: SYSTEM,
      prompt: buildPrompt(topic, url, competitorSnippets),
    });

    const parsed = parseJson<Partial<Suggestions>>(raw, {});
    const angles = Array.isArray(parsed.angles) ? parsed.angles.slice(0, 6) : [];
    const suggestions: Suggestions = {
      headline: parsed.headline?.trim() || "",
      angles: angles as Angle[],
    };

    return NextResponse.json({
      topic,
      serp: serp?.organic
        ? {
            edstellarRank: serp.edstellarRank,
            competitors: serp.organic,
            // #39 — surface PAA + answer box so the UI / writer brief can
            // reuse them. Free data we were already paying Serper for.
            peopleAlsoAsk: serp.peopleAlsoAsk ?? [],
            answerBox: serp.answerBox ?? null,
          }
        : null,
      suggestions,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
