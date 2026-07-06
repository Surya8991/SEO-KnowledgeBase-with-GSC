/**
 * Local draft worker for the AI Draft pipeline (Batch 13).
 *
 * Runs on the operator's machine. Polls the drafts queue, invokes the
 * Claude Code CLI (`claude -p`) against the operator's Max 20x subscription
 * so LLM cost stays at $0 marginal. Writes the generated markdown back to
 * the database via the /api/drafts/:id PATCH endpoint.
 *
 * Usage:
 *   1. Install Claude Code:           https://docs.claude.com/en/docs/claude-code
 *   2. Set env vars in .env.local (or shell):
 *        APP_BASE_URL=https://your-app.vercel.app  (or http://localhost:3000)
 *        WORKER_API_KEY=<same value as on the server>
 *        CLAUDE_MODEL=claude-sonnet-4-6           (optional, default sonnet-4-6)
 *   3. `npm run draft-worker`
 *
 * The worker exits with a clear error if `claude` isn't on PATH; install
 * Claude Code before running.
 */
// Load .env.local first (higher priority, Next.js convention), then .env as a
// fallback for shared values like DATABASE_URL. Without this, worker-only
// secrets in .env.local are invisible to plain `tsx` scripts.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { spawn } from "node:child_process";

interface DraftRow {
  id: number;
  status: string;
  briefMd: string;
}

const APP_BASE_URL    = process.env.APP_BASE_URL    ?? "http://localhost:3000";
const WORKER_API_KEY  = process.env.WORKER_API_KEY  ?? "";
// Provider: claude (Claude Code CLI) | agy (Google Antigravity CLI).
// Both use -p <prompt> --model <name> + capture stdout, so the dispatch
// is identical apart from binary name and the agy permission flag.
const DRAFT_PROVIDER  = (process.env.DRAFT_PROVIDER ?? "claude").toLowerCase();
const CLAUDE_MODEL    = process.env.CLAUDE_MODEL    ?? "claude-sonnet-4-6";
const AGY_MODEL       = process.env.AGY_MODEL       ?? "gemini-3-pro-preview";
const POLL_MS         = Number(process.env.DRAFT_POLL_MS ?? 10_000);
const MAX_RETRIES     = 1;

if (DRAFT_PROVIDER !== "claude" && DRAFT_PROVIDER !== "agy") {
  console.error(`[draft-worker] DRAFT_PROVIDER must be 'claude' or 'agy'. Got '${DRAFT_PROVIDER}'.`);
  process.exit(1);
}

if (!WORKER_API_KEY) {
  console.error("[draft-worker] WORKER_API_KEY is not set. Aborting.");
  process.exit(1);
}

const HEADERS: HeadersInit = {
  "content-type": "application/json",
  "x-worker-key": WORKER_API_KEY,
};

function log(msg: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const tail = extra ? " " + JSON.stringify(extra) : "";
  console.log(`[draft-worker ${ts}] ${msg}${tail}`);
}

async function fetchQueued(): Promise<DraftRow[]> {
  const res = await fetch(`${APP_BASE_URL}/api/drafts?status=queued&limit=1`, {
    headers: HEADERS,
  });
  if (!res.ok) {
    log(`poll failed: ${res.status} ${res.statusText}`);
    return [];
  }
  const data = await res.json();
  return data.rows ?? [];
}

async function patchDraft(id: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${APP_BASE_URL}/api/drafts/${id}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PATCH ${id} failed: ${res.status} ${text}`);
  }
}

/**
 * Provider dispatch. Both Claude Code (`claude`) and Antigravity (`agy`) expose
 *   `<bin> -p "<prompt>" --model <name>`  → markdown to stdout
 * so the wiring is shared. agy additionally needs --dangerously-skip-permissions
 * in headless mode or it pauses on tool prompts.
 *
 * Returns markdown + a rough token estimate (neither CLI emits token counts
 * to stdout in print mode; chars/4 is good enough for UI display).
 */
function invokeAgent(prompt: string): Promise<{ text: string; tokensOut: number; model: string }> {
  const isAgy = DRAFT_PROVIDER === "agy";
  const bin   = isAgy ? "agy" : "claude";
  const model = isAgy ? AGY_MODEL : CLAUDE_MODEL;
  const args  = isAgy
    ? ["-p", prompt, "--model", model, "--dangerously-skip-permissions"]
    : ["-p", prompt, "--model", model];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: process.platform === "win32" });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString() });
    child.stderr.on("data", (b) => { stderr += b.toString() });

    child.on("error", (err: any) => {
      if (err?.code === "ENOENT") {
        const install = isAgy
          ? "Install Antigravity: https://antigravity.google"
          : "Install Claude Code: https://docs.claude.com/en/docs/claude-code";
        reject(new Error(`\`${bin}\` not found on PATH. ${install}`));
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${bin} exited ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new Error(`${bin} returned empty output`));
        return;
      }
      const tokensOut = Math.round(text.length / 4);
      resolve({ text, tokensOut, model });
    });
  });
}

async function processOne(row: DraftRow): Promise<void> {
  log(`processing draft #${row.id}`);
  await patchDraft(row.id, { status: "running" });

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text, tokensOut, model } = await invokeAgent(row.briefMd);
      const tokensIn = Math.round(row.briefMd.length / 4);
      await patchDraft(row.id, {
        status: "done",
        draftMd: text,
        model: `${DRAFT_PROVIDER}:${model}`,
        tokensIn,
        tokensOut,
      });
      log(`draft #${row.id} done`, { provider: DRAFT_PROVIDER, model, tokensOut });
      return;
    } catch (e) {
      lastErr = e as Error;
      log(`draft #${row.id} attempt ${attempt + 1} failed: ${lastErr.message}`);
    }
  }

  await patchDraft(row.id, {
    status: "failed",
    error: lastErr?.message ?? "unknown error",
  }).catch((e) => log(`could not record failure for #${row.id}: ${e.message}`));
}

async function tick(): Promise<void> {
  const queued = await fetchQueued();
  if (queued.length === 0) return;
  for (const row of queued) {
    try { await processOne(row) }
    catch (e) { log(`processOne #${row.id} threw: ${(e as Error).message}`) }
  }
}

async function main(): Promise<void> {
  log(`starting`, {
    base: APP_BASE_URL,
    provider: DRAFT_PROVIDER,
    model: DRAFT_PROVIDER === "agy" ? AGY_MODEL : CLAUDE_MODEL,
    pollMs: POLL_MS,
  });
  // Single warm-up tick so the operator gets immediate feedback on auth /
  // network errors instead of waiting POLL_MS for the first heartbeat.
  await tick();

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try { await tick() }
    catch (e) { log(`tick error: ${(e as Error).message}`) }
  }
}

main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
