import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { assertProdWritesAllowed } from "@/lib/db/prod-guard";

/**
 * Detect corpus pages that no longer resolve 200 — mostly 3xx redirects
 * (a page that 301s to another is NOT a live page and must not appear as its
 * own row in conflict/cluster output). For each such page we record the
 * resolved target in `canonical_url` and flag `is_stale` + a reason, so every
 * consumer can exclude "canonicalized-away" pages with a single WHERE clause.
 *
 * Non-destructive: we mark, we don't delete (a later cleanup can DELETE where
 * stale_reason LIKE 'redirect%'). Idempotent: safe to re-run.
 *
 * Flags: --limit=N  --concurrency=20  --only-null (skip pages already marked)
 */

interface Row { url: string }

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

/** Resolve a URL's live status without following redirects. Returns the 3xx
 *  target (absolute) when redirected, or null when it's a live 2xx page. */
async function probe(url: string): Promise<{ redirectedTo: string; status: number } | null> {
  const tryOnce = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(15000) });
    return res;
  };
  let res: Response;
  try {
    res = await tryOnce("HEAD");
    // Some servers reject HEAD (405) — retry with GET.
    if (res.status === 405 || res.status === 501) res = await tryOnce("GET");
  } catch {
    return null; // network error — leave the page as-is rather than mis-flagging
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) return null;
    const abs = new URL(loc, url).toString();
    // Ignore trailing-slash-only self "redirects".
    if (abs.replace(/\/$/, "") === url.replace(/\/$/, "")) return null;
    return { redirectedTo: abs, status: res.status };
  }
  return null;
}

async function main() {
  const { limit, concurrency, onlyNull } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = neon(url);

  const rows = (await sql.query(
    `SELECT url FROM pages
     WHERE embedding IS NOT NULL
       ${onlyNull ? "AND canonical_url IS NULL AND (is_stale IS NULL OR is_stale = false)" : ""}
     ORDER BY id
     ${limit ? `LIMIT ${limit}` : ""}`,
  )) as Row[];
  console.log(`Probing ${rows.length} URLs · concurrency=${concurrency}`);

  const redirects: { url: string; target: string; reason: string }[] = [];
  let checked = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      if (!r) break;
      const hit = await probe(r.url);
      if (hit) redirects.push({ url: r.url, target: hit.redirectedTo, reason: `redirect ${hit.status}` });
      if (++checked % 200 === 0) console.log(`  ${checked}/${rows.length} checked · ${redirects.length} redirects`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  console.log(`\nFound ${redirects.length} redirected pages.`);
  if (redirects.length) {
    // H5: this UPDATEs the pages table — guard against unintended prod writes.
    assertProdWritesAllowed(`mark ${redirects.length} redirected pages stale`);
    await sql.query(
      `UPDATE pages AS p SET
         canonical_url = t.target,
         is_stale = true,
         stale_reason = t.reason
       FROM unnest($1::text[], $2::text[], $3::text[]) AS t(url, target, reason)
       WHERE p.url = t.url`,
      [redirects.map((r) => r.url), redirects.map((r) => r.target), redirects.map((r) => r.reason)],
    );
    console.log("Marked (canonical_url + is_stale). Sample:");
    for (const r of redirects.slice(0, 10)) console.log(`  ${r.url} → ${r.target}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
