/**
 * Pre-generate draft library (Batch 16).
 *
 * Runs locally on the operator's machine. For each high-value page,
 * builds an editorial brief, calls Antigravity (`agy -p`) or Claude
 * (`claude -p`) — operator's existing subscription, no API cost —
 * captures the markdown, embeds it, and UPSERTs into
 * pregenerated_drafts so /api/drafts can serve it instantly.
 *
 * Usage:
 *   npm run pregen-drafts                       # top 300 high-value pages, resumable
 *   npm run pregen-drafts -- --limit=20         # smoke-test 20 pages
 *   npm run pregen-drafts -- --force            # regenerate even if cached
 *   DRAFT_PROVIDER=claude npm run pregen-drafts # use Claude Code instead of agy
 *
 * Page selection (top 300):
 *   1. All pages with content_type IN ('category', 'subcategory') — hubs
 *   2. Top 200 pages by gsc_clicks_28d
 *   3. Pages whose (course_type, category) cluster has zero TOFU content
 *
 * Idempotent: rows with the same source_url get UPDATEd via upsertDraft.
 * Skips pages already cached unless --force is set.
 */
// Side-effect import runs SYNCHRONOUSLY at module-init, BEFORE the
// `@/lib/db` import below initializes Drizzle with process.env.DATABASE_URL.
// `import { config }` + a top-level call doesn't work — ES modules hoist
// all imports above any code in the body.
import "dotenv/config"; // loads .env (DATABASE_URL lives here)
import { config as loadEnv } from "dotenv";
// .env.local has the worker-only vars (DRAFT_PROVIDER, AGY_MODEL). These
// are read inside main(), well after this line runs.
loadEnv({ path: ".env.local", override: true });

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/exec";
import { getEmbedder } from "@/lib/ai";
import { upsertDraft } from "@/lib/drafts/select";

interface PageRow {
  id: number;
  url: string;
  title: string | null;
  content_type: string | null;
  category: string | null;
  course_type: string | null;
  content_text: string | null;
  meta_description: string | null;
  gsc_clicks_28d: number | null;
  gsc_impressions_28d: number | null;
}

interface Args {
  limit: number;
  force: boolean;
  concurrency: number;
}

function parseArgs(): Args {
  const a: Args = { limit: 300, force: false, concurrency: 1 };
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "limit") a.limit = Number(v);
    else if (k === "force") a.force = true;
    else if (k === "concurrency") a.concurrency = Math.max(1, Number(v));
  }
  return a;
}

const DRAFT_PROVIDER = (process.env.DRAFT_PROVIDER ?? "agy").toLowerCase();
const AGY_MODEL    = process.env.AGY_MODEL    ?? "gemini-3.5-flash-medium";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

if (DRAFT_PROVIDER !== "agy" && DRAFT_PROVIDER !== "claude") {
  console.error(`DRAFT_PROVIDER must be 'agy' or 'claude'. Got '${DRAFT_PROVIDER}'.`);
  process.exit(1);
}

function log(msg: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 19);
  const tail = extra ? " " + JSON.stringify(extra) : "";
  console.log(`[pregen ${ts}] ${msg}${tail}`);
}

async function selectTargetPages(limit: number): Promise<PageRow[]> {
  // Two cheap queries, merged + deduped in JS. The earlier single-CTE
  // version with three UNIONs and a NOT EXISTS subquery hung on the
  // Neon HTTP driver — each scan was fine alone, but unioned across
  // 2,461 rows with a correlated subquery it timed out.
  //
  // Rule 1: top by 28d GSC clicks (covers traffic-priority pages).
  // Rule 2: hub pages (category / subcategory) regardless of traffic.
  // Cluster-gap rule has been dropped from selection — it can be a
  // follow-up batch driven by the /strategy page once the cache exists.
  const cols = sql`id, url, title, content_type, category, course_type,
                   content_text, meta_description, gsc_clicks_28d, gsc_impressions_28d`;

  const topByTraffic = await db.execute(sql`
    SELECT ${cols} FROM pages
    WHERE coalesce(gsc_clicks_28d, 0) > 0
    ORDER BY gsc_clicks_28d DESC NULLS LAST
    LIMIT ${limit * 2}
  `);
  const hubs = await db.execute(sql`
    SELECT ${cols} FROM pages
    WHERE content_type IN ('category', 'subcategory')
    ORDER BY coalesce(gsc_clicks_28d, 0) DESC
  `);

  const seen = new Map<number, PageRow>();
  for (const r of rowsOf<PageRow>(topByTraffic)) seen.set(Number(r.id), r);
  for (const r of rowsOf<PageRow>(hubs))         seen.set(Number(r.id), r);

  return [...seen.values()]
    .sort((a, b) => Number(b.gsc_clicks_28d ?? 0) - Number(a.gsc_clicks_28d ?? 0))
    .slice(0, limit);
}

async function alreadyCached(sourceUrl: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM pregenerated_drafts WHERE source_url = ${sourceUrl} LIMIT 1
  `);
  return rowsOf<unknown>(rows).length > 0;
}

function buildBrief(p: PageRow): string {
  const lines: string[] = [];
  lines.push(`# Content brief — refresh angle for: ${p.title || p.url}`);
  lines.push("");
  lines.push(`**Source URL (the page this draft sits next to):** ${p.url}`);
  if (p.content_type) lines.push(`**Content type:** ${p.content_type}`);
  if (p.category)     lines.push(`**Category:** ${p.category}`);
  if (p.course_type)  lines.push(`**Course type:** ${p.course_type}`);
  if (p.gsc_clicks_28d != null) {
    lines.push(`**28-day GSC:** ${p.gsc_clicks_28d} clicks · ${p.gsc_impressions_28d ?? 0} impressions`);
  }
  lines.push("");

  if (p.meta_description) {
    lines.push("## Current meta description");
    lines.push(p.meta_description);
    lines.push("");
  }
  if (p.content_text) {
    lines.push("## Excerpt of current page content");
    lines.push(p.content_text.slice(0, 2000));
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push("Write a publish-ready 1500–2500 word **companion blog post** for the page above. Do NOT rewrite the existing page — write a *different* angle that supports it (a complementary deep-dive, a how-to, a beginner's guide, a frequently-asked-questions explainer — whichever fits best given the page's content type).");
  lines.push("");
  lines.push("### Output format (strict)");
  lines.push("Return ONLY the article. No preamble, no \"Here is your article\", no closing remarks. The first line must be the H1 (`# Title`). The second line must be `> Meta: <description ≤155 chars>`. The last line must be the conclusion's final sentence. Markdown only — no HTML.");
  lines.push("");
  lines.push("### Required structure");
  lines.push("1. H1 title — under 65 chars, includes a primary keyword, no clickbait.");
  lines.push("2. Meta line: `> Meta: <description ≤155 chars>`.");
  lines.push("3. Intro 90–130 words.");
  lines.push("4. 4–7 H2 sections @ 200–400 words each, with H3 subsections where helpful.");
  lines.push("5. `## Frequently Asked Questions` with 4–6 H3 questions, 50–90 word answers each.");
  lines.push("6. Conclusion 80–120 words ending with a single specific next-step.");
  lines.push("");
  lines.push("### Voice & quality bar");
  lines.push("- Audience: corporate L&D / HR / training managers at mid-to-large enterprises.");
  lines.push("- Tone: expert, neutral, educational. Active voice, avg sentence ≤20 words.");
  lines.push("- Ban these phrases: \"unlock\", \"empower\", \"revolutionize\", \"in today's\", \"game-changer\", \"fast-paced world\".");
  lines.push("");
  lines.push("### Hard rules");
  lines.push("- No invented statistics or fake citations. Use only well-known industry benchmarks.");
  lines.push("- No fake quotes attributed to real people.");
  lines.push("- Do not mention competitors by name.");
  lines.push("- Link back to the source URL above as `[anchor text](" + p.url + ")` once, in a contextually natural place.");
  lines.push("- The article must stand on its own — a reader who never visits the source URL still gets full value.");
  return lines.join("\n");
}

function invokeAgent(prompt: string): Promise<{ text: string; tokensOut: number; model: string }> {
  const isAgy = DRAFT_PROVIDER === "agy";
  // Windows: append .exe so spawn(shell:false) can find it on PATH.
  // Without shell:false the prompt (which contains markdown, newlines,
  // and unquoted words) gets reparsed by cmd.exe and the first space
  // turns subsequent words into "command not found" errors.
  const binBase = isAgy ? "agy" : "claude";
  const bin = process.platform === "win32" ? `${binBase}.exe` : binBase;
  const model = isAgy ? AGY_MODEL : CLAUDE_MODEL;
  const args  = isAgy
    ? ["-p", prompt, "--model", model, "--dangerously-skip-permissions"]
    : ["-p", prompt, "--model", model];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString() });
    child.stderr.on("data", (b) => { stderr += b.toString() });
    child.on("error", (err: any) => {
      if (err?.code === "ENOENT") {
        reject(new Error(`\`${bin}\` not on PATH. Install ${isAgy ? "Antigravity" : "Claude Code"}.`));
      } else reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${bin} exited ${code}: ${stderr.trim() || "no stderr"}`));
      const text = stdout.trim();
      if (!text) return reject(new Error(`${bin} returned empty output`));
      resolve({ text, tokensOut: Math.round(text.length / 4), model });
    });
  });
}

async function processPage(
  page: PageRow,
  embedder: ReturnType<typeof getEmbedder>,
  force: boolean,
): Promise<"cached" | "ok" | "fail"> {
  if (!force && (await alreadyCached(page.url))) {
    return "cached";
  }
  const brief = buildBrief(page);
  const contextHash = createHash("sha256").update(brief).digest("hex").slice(0, 16);

  log(`generating`, { id: page.id, url: page.url });
  const t0 = Date.now();
  const { text, tokensOut, model } = await invokeAgent(brief);
  const genMs = Date.now() - t0;

  const [embedding] = await embedder.embed([text]);
  if (!embedding) throw new Error("embedder returned no vector");

  await upsertDraft({
    topic: page.title || page.url,
    sourceUrl: page.url,
    draftMd: text,
    embedding,
    model: `${DRAFT_PROVIDER}:${model}`,
    contextHash,
    tokensIn: Math.round(brief.length / 4),
    tokensOut,
  });
  log(`done`, { id: page.id, ms: genMs, tokensOut });
  return "ok";
}

async function main() {
  const args = parseArgs();
  log(`starting`, { provider: DRAFT_PROVIDER, limit: args.limit, force: args.force, concurrency: args.concurrency });

  const pages = await selectTargetPages(args.limit);
  log(`selected ${pages.length} pages to process`);

  const embedder = getEmbedder();

  let okCount = 0, cachedCount = 0, failCount = 0;
  // Sequential by default — local CLI is single-tenant and concurrent
  // spawns can hammer the embedder cache. Bump --concurrency if your
  // machine can handle it.
  if (args.concurrency === 1) {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      try {
        const r = await processPage(page, embedder, args.force);
        if (r === "ok") okCount++;
        else if (r === "cached") { cachedCount++; }
      } catch (e) {
        failCount++;
        log(`FAIL #${page.id}: ${(e as Error).message}`);
      }
      log(`progress ${i + 1}/${pages.length} · ok=${okCount} cached=${cachedCount} fail=${failCount}`);
    }
  } else {
    // Simple bucketed concurrency — N workers pulling from a shared queue.
    const queue = [...pages];
    await Promise.all(
      Array.from({ length: args.concurrency }, async () => {
        while (queue.length) {
          const page = queue.shift();
          if (!page) break;
          try {
            const r = await processPage(page, embedder, args.force);
            if (r === "ok") okCount++;
            else if (r === "cached") cachedCount++;
          } catch (e) {
            failCount++;
            log(`FAIL #${page.id}: ${(e as Error).message}`);
          }
        }
      }),
    );
  }

  log(`complete · ok=${okCount} cached=${cachedCount} fail=${failCount}`);
}

main().catch((e) => {
  console.error(`[pregen fatal] ${(e as Error).message}`);
  process.exit(1);
});
