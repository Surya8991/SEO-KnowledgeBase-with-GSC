/**
 * K-means clustering over page embeddings. Writes pages.cluster_id and a
 * row per cluster into the `clusters` table (with an auto-derived label).
 * Run: npm run cluster -- --k=24 [--seed=1234]
 *
 * Audit 10C polish (Session 9):
 *   - Added --seed for reproducibility (mulberry32 PRNG; Math.random() is
 *     non-deterministic so two runs over the same corpus could land on
 *     different clusters, making downstream diffs noisy).
 *   - Wrapped the TRUNCATE clusters + per-cluster INSERT loop in a single
 *     transaction so a mid-run failure leaves the prior clusters in place
 *     instead of an empty table.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

interface Row { id: number; title: string | null; category: string | null; embedding: string }

function parseArgs() {
  let k = 24;
  let maxIters = 20;
  let seed: number | null = null;
  for (const arg of process.argv.slice(2)) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    if (key === "k") k = Number(val);
    else if (key === "iters") maxIters = Number(val);
    else if (key === "seed") seed = Number(val);
  }
  return { k, maxIters, seed };
}

/**
 * mulberry32 — small, fast, well-distributed seedable PRNG. Returns a
 * function with the same contract as Math.random() (yields [0, 1)).
 * Falls back to Math.random when no seed is provided so the legacy
 * non-deterministic behaviour is preserved for ad-hoc runs.
 */
function makeRng(seed: number | null): () => number {
  if (seed === null || Number.isNaN(seed)) return Math.random;
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseVec(s: string): number[] {
  // pgvector returns "[0.1,0.2,...]"
  return s.replace(/^\[|\]$/g, "").split(",").map(Number);
}
function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return s;
}
function add(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
}
function scale(a: number[], s: number) {
  for (let i = 0; i < a.length; i++) a[i] *= s;
}

async function main() {
  const { k, maxIters, seed } = parseArgs();
  const sql = neon(process.env.DATABASE_URL!);
  const rng = makeRng(seed);
  if (seed !== null) console.log(`Deterministic run, seed=${seed}`);

  console.log(`Loading embeddings...`);
  const rows = (await sql.query(
    `SELECT id, title, category, embedding::text AS embedding
       FROM pages WHERE embedding IS NOT NULL`,
  )) as Row[];
  console.log(`  ${rows.length} pages`);

  const vecs = rows.map((r) => parseVec(r.embedding));
  const dim = vecs[0].length;

  // k-means++ init
  console.log(`k-means++ init, k=${k}, dim=${dim}`);
  const centers: number[][] = [];
  centers.push(vecs[Math.floor(rng() * vecs.length)].slice());
  while (centers.length < k) {
    const d2 = vecs.map((v) => Math.min(...centers.map((c) => dist2(v, c))));
    const sum = d2.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    let i = 0;
    while (i < d2.length && (r -= d2[i]) > 0) i++;
    centers.push(vecs[Math.min(i, vecs.length - 1)].slice());
  }

  // Lloyd's algorithm
  const assign = new Int32Array(vecs.length);
  for (let iter = 0; iter < maxIters; iter++) {
    let moved = 0;
    for (let i = 0; i < vecs.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(vecs[i], centers[c]);
        if (d < bestD) { bestD = d; best = c }
      }
      if (assign[i] !== best) { assign[i] = best; moved++ }
    }
    const newCenters: number[][] = Array.from({ length: k }, () => Array(dim).fill(0));
    const counts = new Int32Array(k);
    for (let i = 0; i < vecs.length; i++) {
      add(newCenters[assign[i]], vecs[i]);
      counts[assign[i]]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c]) scale(newCenters[c], 1 / counts[c]);
      else newCenters[c] = vecs[Math.floor(rng() * vecs.length)].slice();
    }
    for (let c = 0; c < k; c++) centers[c] = newCenters[c];
    console.log(`  iter ${iter + 1}: moved ${moved}`);
    if (moved === 0) break;
  }

  // Auto-label each cluster from the most common category among its members.
  const buckets: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < vecs.length; i++) buckets[assign[i]].push(i);

  /**
   * Audit 10C polish (Session 9): wrap TRUNCATE + per-cluster INSERT in
   * a single transaction so a mid-loop failure leaves the prior clusters
   * intact. Without this, a partial run produces an empty `clusters`
   * table and broken `pages.cluster_id` references for every row whose
   * INSERT/UPDATE hadn't completed.
   */
  await sql.query("BEGIN");
  try {
    await sql.query("TRUNCATE clusters");
    for (let c = 0; c < k; c++) {
      const tally = new Map<string, number>();
      for (const i of buckets[c]) {
        const cat = rows[i].category || (rows[i].title?.split(/\s+/).slice(0, 3).join(" ") ?? "");
        if (cat) tally.set(cat, (tally.get(cat) ?? 0) + 1);
      }
      const label = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `Cluster ${c + 1}`;
      const ins = (await sql.query(
        `INSERT INTO clusters (label, size) VALUES ($1,$2) RETURNING id`,
        [label, buckets[c].length],
      )) as any[];
      const clusterId = Number(ins[0].id);
      const ids = buckets[c].map((i) => rows[i].id);
      if (ids.length) {
        await sql.query(`UPDATE pages SET cluster_id = $1 WHERE id = ANY($2::int[])`, [clusterId, ids]);
      }
      console.log(`  cluster ${c + 1}: "${label}" (${buckets[c].length} pages)`);
    }
    await sql.query("COMMIT");
  } catch (e) {
    await sql.query("ROLLBACK").catch(() => {});
    throw e;
  }
  console.log(`\n✓ Done. Browse with: SELECT label, size FROM clusters ORDER BY size DESC;`);
}
main().catch((e) => { console.error(e); process.exit(1); });
