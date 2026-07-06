/**
 * HEAD-check every URL in the corpus, write status to pages.http_status.
 * Run: npm run audit:links            (every page)
 *      npm run audit:links -- --limit=200  (sample)
 *      npm run audit:links -- --only-stale (only those never audited)
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

interface Row { id: number; url: string }

function parseArgs() {
  const a: { limit?: number; onlyStale?: boolean; concurrency: number } = { concurrency: 12 };
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "limit") a.limit = Number(v);
    else if (k === "only-stale") a.onlyStale = true;
    else if (k === "concurrency") a.concurrency = Number(v);
  }
  return a;
}

async function check(url: string): Promise<number> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15_000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: c.signal, redirect: "follow" });
    // some servers reject HEAD; try GET on 405/501
    if (res.status === 405 || res.status === 501) {
      const r2 = await fetch(url, { method: "GET", signal: c.signal, redirect: "follow" });
      return r2.status;
    }
    return res.status;
  } catch {
    return 0; // network/timeout
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = parseArgs();
  const sql = neon(process.env.DATABASE_URL!);
  const where = args.onlyStale ? "WHERE http_status IS NULL" : "";
  const lim = args.limit ? `LIMIT ${args.limit}` : "";
  const rows = (await sql.query(
    `SELECT id, url FROM pages ${where} ORDER BY id ${lim}`,
  )) as Row[];
  console.log(`Auditing ${rows.length} URLs · concurrency=${args.concurrency}`);

  let done = 0;
  let broken = 0;
  const queue = [...rows];

  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      if (!row) return;
      const status = await check(row.url);
      if (status === 0 || status >= 400) broken++;
      await sql.query(
        `UPDATE pages SET http_status = $1, last_audited_at = now() WHERE id = $2`,
        [status || null, row.id],
      );
      done++;
      if (done % 50 === 0) process.stdout.write(`  ${done}/${rows.length} (${broken} broken)\n`);
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  console.log(`\n✓ Audited ${done} URLs. Broken/unreachable: ${broken}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
