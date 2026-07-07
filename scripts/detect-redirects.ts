import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { assertProdWritesAllowed } from "@/lib/db/prod-guard";

/**
 * Detect corpus pages that no longer resolve 200 and reconcile the stale marks
 * every other consumer relies on:
 *   - 3xx redirects → record the target in `canonical_url`, flag `is_stale` +
 *     `stale_reason = 'redirect <status>'` (a 301'd page is NOT a live page and
 *     must not appear as its own row in conflict/cluster output).
 *   - 4xx/5xx dead pages (404/410/…) → flag `is_stale`, no canonical target,
 *     `stale_reason = 'http <status>'` (previously these stayed "live").
 *   - HEALING: a page that now probes 200 again but was previously marked stale
 *     has its marks CLEARED (a temporary WAF/maintenance 3xx no longer pins it
 *     stale forever). Healing runs in full mode only, not with --only-null.
 *
 * Non-destructive: we mark, we don't delete. Idempotent: safe to re-run.
 *
 * Flags: --limit=N  --concurrency=20  --only-null (skip pages already marked)
 */

interface Row { url: string; is_stale: boolean | null }

/** Classified probe result. `null` = network error (leave the row untouched). */
type Probe =
  | { kind: "redirect"; target: string; status: number }
  | { kind: "dead"; status: number }
  | { kind: "live" };

function parseArgs() {
  let limit: number | null = null;
  let concurrency = 20;
  let onlyNull = false;
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "limit") limit = Number(v);
    else if (k === "concurrency") concurrency = Number(v);
    else if (k === "only-null") onlyNull = true;
  }
  return { limit, concurrency, onlyNull };
}

/** Probe a URL without following redirects and classify it. Returns null only
 *  on a network error, so a live 200 is distinguishable from an unreachable
 *  host (the latter must NOT trigger healing). */
async function probe(url: string): Promise<Probe | null> {
  const tryOnce = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(15000) });
    return res;
  };
  let res: Response;
  try {
    res = await tryOnce("HEAD");
    // Some servers reject HEAD (405) - retry with GET.
    if (res.status === 405 || res.status === 501) res = await tryOnce("GET");
  } catch {
    return null; // network error - leave the page as-is rather than mis-flagging
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const abs = new URL(loc, url).toString();
      // A trailing-slash-only self "redirect" is a live page, not stale.
      if (abs.replace(/\/$/, "") !== url.replace(/\/$/, ""))
        return { kind: "redirect", target: abs, status: res.status };
    }
    return { kind: "live" }; // 3xx without a usable/foreign target → treat as live
  }
  if (res.status >= 400) return { kind: "dead", status: res.status };
  return { kind: "live" };
}

async function main() {
  const { limit, concurrency, onlyNull } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = neon(url);

  const rows = (await sql.query(
    `SELECT url, is_stale FROM pages
     WHERE embedding IS NOT NULL
       ${onlyNull ? "AND canonical_url IS NULL AND (is_stale IS NULL OR is_stale = false)" : ""}
     ORDER BY id
     ${limit ? `LIMIT ${limit}` : ""}`,
  )) as Row[];
  console.log(`Probing ${rows.length} URLs · concurrency=${concurrency}`);

  const redirects: { url: string; target: string; reason: string }[] = [];
  const dead: { url: string; reason: string }[] = [];
  const healed: string[] = []; // previously-stale pages that now resolve 200
  let checked = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      if (!r) break;
      const hit = await probe(r.url);
      if (hit) {
        if (hit.kind === "redirect")
          redirects.push({ url: r.url, target: hit.target, reason: `redirect ${hit.status}` });
        else if (hit.kind === "dead")
          dead.push({ url: r.url, reason: `http ${hit.status}` });
        else if (hit.kind === "live" && r.is_stale) healed.push(r.url); // was stale, now live
      }
      if (++checked % 200 === 0)
        console.log(
          `  ${checked}/${rows.length} checked · ${redirects.length} redirects · ${dead.length} dead · ${healed.length} healed`,
        );
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  console.log(
    `\nFound ${redirects.length} redirected, ${dead.length} dead (4xx/5xx), ${healed.length} healed (200-again).`,
  );

  // H5: these UPDATE the pages table — guard against unintended prod writes.
  if (redirects.length || dead.length || healed.length) {
    assertProdWritesAllowed(
      `reconcile ${redirects.length} redirect + ${dead.length} dead + ${healed.length} healed page marks`,
    );
  }

  if (redirects.length) {
    await sql.query(
      `UPDATE pages AS p SET
         canonical_url = t.target,
         is_stale = true,
         stale_reason = t.reason
       FROM unnest($1::text[], $2::text[], $3::text[]) AS t(url, target, reason)
       WHERE p.url = t.url`,
      [redirects.map((r) => r.url), redirects.map((r) => r.target), redirects.map((r) => r.reason)],
    );
    console.log("Marked redirects (canonical_url + is_stale). Sample:");
    for (const r of redirects.slice(0, 10)) console.log(`  ${r.url} → ${r.target}`);
  }

  if (dead.length) {
    // Dead pages have no canonical target - clear it so a stale redirect target
    // from a prior run can't linger.
    await sql.query(
      `UPDATE pages AS p SET
         is_stale = true,
         canonical_url = NULL,
         stale_reason = t.reason
       FROM unnest($1::text[], $2::text[]) AS t(url, reason)
       WHERE p.url = t.url`,
      [dead.map((r) => r.url), dead.map((r) => r.reason)],
    );
    console.log(`Marked ${dead.length} dead pages (is_stale, http <status>).`);
  }

  if (healed.length) {
    // Clear the stale marks on pages that resolve 200 again (only ones actually
    // flagged stale - guarded in SQL too, so a concurrent re-mark isn't undone).
    await sql.query(
      `UPDATE pages SET
         is_stale = false,
         canonical_url = NULL,
         stale_reason = NULL
       WHERE url = ANY($1::text[]) AND is_stale = true`,
      [healed],
    );
    console.log(`Healed ${healed.length} pages back to live.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
