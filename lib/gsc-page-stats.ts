/**
 * Per-URL and per-query GSC stats.
 *  - pageStats(url)  → totals for last 6m & 12m + top-3 queries for that URL
 *  - queryStats(q)   → totals for last 6m & 12m + top pages ranking for it
 *  - lookup(input)   → auto-detect URL vs query and return the right one
 */
import { google } from "googleapis";
import { getAuthorizedClient, resolveRange, resolveSiteUrl } from "@/lib/gsc";

interface GscRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }

interface BucketTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PageStats {
  url: string;
  m6:  BucketTotals;
  m12: BucketTotals;
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  /** Queries this page is ranking for but in striking distance (position 11-30,
   *  sorted by impressions). Surfacing opportunity, not current performance. */
  potentialQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

export interface QueryStats {
  query: string;
  m6:  BucketTotals;
  m12: BucketTotals;
  topPages: { url: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

function sum(rows: GscRow[]): BucketTotals {
  if (!rows.length) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let c = 0, i = 0, pSum = 0;
  for (const r of rows) { c += r.clicks; i += r.impressions; pSum += r.position }
  return { clicks: c, impressions: i, ctr: i ? c / i : 0, position: pSum / rows.length };
}

async function runQuery(
  client: any, siteUrl: string, startDate: string, endDate: string,
  dimensions: string[], rowLimit = 1000,
  filter?: { dimension: string; expression: string },
): Promise<GscRow[]> {
  const webmasters = google.webmasters({ version: "v3", auth: client });
  const res = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate, endDate, dimensions, rowLimit,
      ...(filter ? { dimensionFilterGroups: [{ filters: [{ dimension: filter.dimension, operator: "equals", expression: filter.expression }] }] } : {}),
    },
  });
  return (res.data.rows ?? []) as GscRow[];
}

async function setup() {
  const client = await getAuthorizedClient();
  if (!client) throw new Error("Not connected to Google Search Console.");
  const siteUrl = await resolveSiteUrl(client);
  const m6  = resolveRange("6m");
  const m12 = resolveRange("12m");
  return { client, siteUrl, m6, m12 };
}

export async function pageStats(url: string, topN = 3): Promise<PageStats> {
  const { client, siteUrl, m6, m12 } = await setup();
  // Pull a wider query slice (100) so we can derive BOTH the top-by-clicks
  // and the striking-distance opportunities from the same call.
  const [d6, d12, queries] = await Promise.all([
    runQuery(client, siteUrl, m6.startDate, m6.endDate, ["date"], 200, { dimension: "page", expression: url }),
    runQuery(client, siteUrl, m12.startDate, m12.endDate, ["date"], 400, { dimension: "page", expression: url }),
    runQuery(client, siteUrl, m6.startDate, m6.endDate, ["query"], 100, { dimension: "page", expression: url }),
  ]);
  const mapRow = (r: GscRow) => ({
    query: r.keys?.[0] ?? "",
    clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
  });
  const topQueries = queries.slice(0, topN).map(mapRow);
  const potentialQueries = queries
    .filter((r) => r.position >= 11 && r.position <= 30 && r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, topN)
    .map(mapRow);
  return {
    url,
    m6: sum(d6),
    m12: sum(d12),
    topQueries,
    potentialQueries,
  };
}

export async function queryStats(query: string, topN = 5): Promise<QueryStats> {
  const { client, siteUrl, m6, m12 } = await setup();
  const [d6, d12, pages] = await Promise.all([
    runQuery(client, siteUrl, m6.startDate, m6.endDate, ["date"], 200, { dimension: "query", expression: query }),
    runQuery(client, siteUrl, m12.startDate, m12.endDate, ["date"], 400, { dimension: "query", expression: query }),
    runQuery(client, siteUrl, m6.startDate, m6.endDate, ["page"], 25, { dimension: "query", expression: query }),
  ]);
  return {
    query,
    m6: sum(d6),
    m12: sum(d12),
    topPages: pages.slice(0, topN).map((r) => ({
      url: r.keys?.[0] ?? "",
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    })),
  };
}

/** Auto-detect URL vs free-text query. URL = starts with http(s) or contains a path slash. */
export async function lookup(input: string) {
  const s = input.trim();
  const looksUrl = /^https?:\/\//i.test(s) || s.includes("/");
  if (looksUrl) {
    const url = /^https?:\/\//i.test(s) ? s : `https://www.edstellar.com${s.startsWith("/") ? s : "/" + s}`;
    return { kind: "url" as const, data: await pageStats(url, 10) };
  }
  return { kind: "query" as const, data: await queryStats(s, 10) };
}

/**
 * Batched per-URL stats — used by the Conflict Checker enrich endpoint.
 * Runs sequentially (each pageStats already issues 3 calls; we don't want to
 * blow GSC quota by fanning out 10×3 in parallel).
 */
export async function pageStatsBatch(urls: string[], topN = 3): Promise<PageStats[]> {
  const out: PageStats[] = [];
  for (const u of urls) {
    try { out.push(await pageStats(u, topN)) }
    catch { out.push({ url: u, m6: sum([]), m12: sum([]), topQueries: [], potentialQueries: [] }) }
  }
  return out;
}
