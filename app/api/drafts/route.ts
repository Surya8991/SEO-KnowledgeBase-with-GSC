import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { drafts, checks } from "@/lib/db/schema";
import { auth, isAuthEnabled } from "@/auth";
import { clientIp } from "@/lib/rate-limit";
import { getEmbedder } from "@/lib/ai";
import { resolveDraft } from "@/lib/drafts/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/drafts  — enqueue a draft generation request from a checkId.
 * The route builds the brief from the check + its top matches and stores
 * it as `brief_md`. The local worker picks it up via GET ?status=queued.
 *
 * GET /api/drafts            — list drafts (UI history; session-gated)
 * GET /api/drafts?status=    — worker poll (requires X-Worker-Key)
 */

// Batch 17: POST /api/drafts is now SYNCHRONOUS. It does a vector lookup
// against pregenerated_drafts and either returns the cached row (instant)
// or calls Groq to adapt/generate (~2-8s).
// We accept either `input` directly (URL or topic string) or `checkId`
// (we look up the input from the checks row). `context` is the optional
// editorial brief — same shape as the existing copyWriterBrief output.
const CreateBody = z.object({
  input: z.string().trim().min(1).max(4000).optional(),
  checkId: z.coerce.number().int().positive().optional(),
  context: z.string().max(12_000).optional(),
  forceFresh: z.boolean().optional(),
}).refine((v) => v.input || v.checkId, {
  message: "Either input or checkId is required.",
});

function workerKeyOk(req: NextRequest): boolean {
  const required = process.env.WORKER_API_KEY;
  if (!required) return false;
  return req.headers.get("x-worker-key") === required;
}

async function requireSession(req: NextRequest): Promise<string | NextResponse> {
  if (!isAuthEnabled()) return `anon:${clientIp(req)}`;
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return session.user.email;
}

export async function POST(request: NextRequest) {
  try {
    const requester = await requireSession(request);
    if (requester instanceof NextResponse) return requester;

    const raw = await request.json().catch(() => ({}));
    const parsed = CreateBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // 1. Resolve the topic string. Prefer the inline `input` (sidesteps
    //    the in-flight persist bug where checkId is sometimes missing
    //    from /api/check responses); fall back to the check row.
    let topic = body.input?.trim() ?? "";
    let context = body.context ?? "";
    let checkId: number | null = body.checkId ?? null;

    if (!topic && checkId) {
      const check = await db.query.checks.findFirst({
        where: eq(checks.id, checkId),
      });
      if (!check) {
        return NextResponse.json({ error: "Check not found." }, { status: 404 });
      }
      topic = check.inputValue;
      if (!context) {
        // Build the same brief the legacy queue used, so editorial
        // context (avoid-list, link targets) still reaches the LLM.
        context = await buildBriefFromCheckId(checkId);
      }
    }

    if (!topic) {
      return NextResponse.json({ error: "input or checkId is required." }, { status: 400 });
    }

    // 2. Embed the topic so we can vector-search the cache.
    const embedder = getEmbedder();
    const [embedding] = await embedder.embed([topic]);
    if (!embedding) {
      return NextResponse.json({ error: "Embedding failed." }, { status: 500 });
    }

    // 3. Cache-first resolver. Cached returns instantly; Groq fallback
    //    takes 2-8s and self-caches the output for next time.
    const resolved = await resolveDraft(topic, embedding, {
      context,
      forceFresh: body.forceFresh ?? false,
    });

    // 4. Best-effort audit row in `drafts` (Batch 11 table) so /api/drafts
    //    GET history still works. Failure here doesn't block the response.
    let auditId: number | null = null;
    try {
      const [row] = await db
        .insert(drafts)
        .values({
          checkId,
          status: "done",
          briefMd: context || `Topic: ${topic}`,
          draftMd: resolved.draftMd,
          model: resolved.model,
          tokensIn: resolved.tokensIn ?? null,
          tokensOut: resolved.tokensOut ?? null,
          requestedBy: requester,
          startedAt: new Date(),
          completedAt: new Date(),
        })
        .returning();
      auditId = row.id;
    } catch (e) {
      console.warn("[api/drafts] audit insert failed:", (e as Error).message);
    }

    return NextResponse.json({
      id: auditId,
      status: "done",
      draftMd: resolved.draftMd,
      source: resolved.source,
      similarity: resolved.similarity,
      model: resolved.model,
      sourceUrl: resolved.sourceUrl,
      tokensIn: resolved.tokensIn ?? null,
      tokensOut: resolved.tokensOut ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Draft generation failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);

    // Worker poll: X-Worker-Key required, returns queued rows oldest-first.
    if (statusFilter === "queued") {
      if (!workerKeyOk(request)) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
      const rows = await db.query.drafts.findMany({
        where: eq(drafts.status, "queued"),
        orderBy: (d, { asc }) => [asc(d.requestedAt)],
        limit,
      });
      return NextResponse.json({ rows });
    }

    // UI history: session-gated.
    const requester = await requireSession(request);
    if (requester instanceof NextResponse) return requester;

    const rows = await db.query.drafts.findMany({
      orderBy: (d, { desc }) => [desc(d.requestedAt)],
      limit,
    });
    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        checkId: r.checkId,
        status: r.status,
        model: r.model,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        requestedBy: r.requestedBy,
        requestedAt: r.requestedAt,
        completedAt: r.completedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Failed to list drafts." },
      { status: 500 },
    );
  }
}

/**
 * Compose the Markdown brief that gets handed to Claude.
 * Mirrors copyWriterBrief() in conflict-checker page, but reads from DB so
 * the worker has the same context regardless of which session enqueued.
 */
async function buildBriefFromCheckId(checkId: number): Promise<string> {
  const check = await db.query.checks.findFirst({
    where: eq(checks.id, checkId),
  }).catch(() => null);

  if (!check) return `# Draft brief\n\nCheck #${checkId} not found.`;

  const matches = await db.query.checkMatches.findMany({
    where: (m, { eq }) => eq(m.checkId, checkId),
    orderBy: (m, { desc }) => [desc(m.conflictScore)],
    limit: 20,
  });

  const lines: string[] = [];
  lines.push(`# Content brief — Check #${checkId}`);
  lines.push("");
  lines.push(`**Input type:** ${check.inputType}`);
  lines.push(`**Topic / source:** ${check.inputValue}`);
  lines.push(`**Top conflict score:** ${check.topScore ?? "—"}%`);
  lines.push("");

  if (check.summary) {
    lines.push("## Summary of intended content");
    lines.push(check.summary);
    lines.push("");
  }

  if (check.keywords) {
    let kws: string[] = [];
    try { kws = JSON.parse(check.keywords) } catch { /* ignore */ }
    if (kws.length) {
      lines.push("## Keyword set");
      lines.push(kws.map((k) => `- ${k}`).join("\n"));
      lines.push("");
    }
  }

  const avoid = matches.filter((m) => (m.conflictScore ?? 0) >= 60);
  if (avoid.length) {
    lines.push("## Avoid overlap with these existing pages");
    for (const m of avoid) {
      lines.push(`- [${m.pageTitle || m.pageUrl}](${m.pageUrl}) — score ${m.conflictScore}%, ${m.conflictType ?? "unknown"}`);
      if (m.rationale) lines.push(`  - ${m.rationale}`);
    }
    lines.push("");
  }

  const linkTargets = matches.filter(
    (m) => (m.conflictScore ?? 0) < 60 && (m.conflictScore ?? 0) >= 30,
  );
  if (linkTargets.length) {
    lines.push("## Suggested internal-link targets (related, not overlapping)");
    for (const m of linkTargets.slice(0, 8)) {
      lines.push(`- [${m.pageTitle || m.pageUrl}](${m.pageUrl})`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Instructions for the writer");
  lines.push("");
  lines.push("**Your job:** Produce a publish-ready 1500–2500 word article in Markdown that Edstellar can publish on its blog with minimal editing.");
  lines.push("");
  lines.push("### Output format (strict)");
  lines.push("Return ONLY the article. No preamble, no \"Here is your article:\", no closing remarks. The first line must be the H1 (`# Title`). The last line must be the conclusion's final sentence. Markdown only — no HTML.");
  lines.push("");
  lines.push("### Required structure");
  lines.push("1. **H1 title** — under 65 chars, includes the primary keyword once, no clickbait.");
  lines.push("2. **Meta description block** — second line: `> Meta: <description ≤155 chars>` (this line gets stripped before publish; it's for SEO).");
  lines.push("3. **Intro** — 90–130 words. State the problem, who it's for (corporate L&D / HR / training managers), and what the reader will learn. No \"In today's fast-paced world…\".");
  lines.push("4. **4–7 H2 sections** — each with 200–400 words. Use H3 subsections where helpful. Lead with the answer, then explain.");
  lines.push("5. **FAQ section** — `## Frequently Asked Questions` with 4–6 H3 questions. Answer each in 50–90 words. Pull from the People-Also-Ask list if available.");
  lines.push("6. **Conclusion** — 80–120 words. Summarize the 2–3 most important takeaways and give a single, specific next step (e.g., \"Audit your current training catalogue against this checklist\").");
  lines.push("");
  lines.push("### Voice & quality bar");
  lines.push("- Audience: corporate L&D, HR, learning managers at mid-to-large enterprises.");
  lines.push("- Tone: expert, neutral, educational. No marketing fluff (\"unlock\", \"empower\", \"revolutionize\", \"in today's…\", \"game-changer\").");
  lines.push("- Active voice. Short sentences (avg ≤20 words). One idea per paragraph.");
  lines.push("- Concrete examples > abstract claims. If you make a claim, support it.");
  lines.push("- Use lists and tables when they aid scanning, not as filler.");
  lines.push("");
  lines.push("### Hard rules — do not break these");
  lines.push("- **No invented statistics.** If you use a number, it must be one you genuinely know to be true (well-known industry benchmarks are OK). Never write \"studies show 73% of…\" without a citation, and don't fabricate citations.");
  lines.push("- **No fake quotes.** Don't attribute statements to real people unless they're public, verifiable, and you cite the source.");
  lines.push("- **No competitor name-dropping** beyond what's already in the brief above.");
  lines.push("- **Differentiate from the 'avoid' list.** Do NOT rewrite or paraphrase those pages — read what they cover and take a deliberately different angle (different audience, different framework, different depth, or a counterargument).");
  lines.push("- **Use the internal-link targets** above where contextually relevant. Format as Markdown links: `[anchor text](url)`. 3–6 internal links across the article.");
  lines.push("- **Address the People-Also-Ask questions** from the brief above somewhere in the body (not only in the FAQ — weave them into H2 sections too). This is how the article earns AI Overview / featured-snippet placement.");
  lines.push("- **Primary keyword** should appear in: H1, first 100 words, at least one H2, and the meta description.");
  lines.push("");
  lines.push("### SEO niceties");
  lines.push("- Include 2–3 secondary keywords from the keyword set naturally throughout.");
  lines.push("- Use bolded definitions for key terms on first mention.");
  lines.push("- Aim for an FAQ that directly mirrors PAA wording — that's what wins AI citations.");
  return lines.join("\n");
}
