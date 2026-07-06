/**
 * SERP overlap, domain comparison, content freshness — built on top of the
 * existing Serper integration + corpus + competitor sitemap fetches.
 */
import { KNOWN_COMPETITORS, isEdstellarDomain } from "@/lib/competitors";
import { fetchAndExtract } from "@/lib/extract";

interface SerpOrganic { title: string; link: string; snippet?: string; position?: number }
interface SerpAiOverview {
  summary?: string;
  citations?: { title?: string; link?: string; snippet?: string }[];
}
interface SerpPeopleAlsoAsk {
  question?: string;
  snippet?: string;
  title?: string;
  link?: string;
}
interface SerperResponse {
  organic?: SerpOrganic[];
  /** Serper has used several field names for AI Overviews — handle both. */
  aiOverview?: SerpAiOverview;
  aiOverviews?: SerpAiOverview | SerpAiOverview[];
  answerBox?: { title?: string; link?: string; snippet?: string };
  /** "People also ask" box on the SERP. (#39) */
  peopleAlsoAsk?: SerpPeopleAlsoAsk[];
}

async function serperSearch(query: string, num = 10): Promise<SerperResponse> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is not set.");
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) throw new Error(`Serper failed: ${res.status}`);
  return (await res.json()) as SerperResponse;
}

function pickAiOverview(r: SerperResponse): SerpAiOverview | undefined {
  if (r.aiOverview) return r.aiOverview;
  if (Array.isArray(r.aiOverviews)) return r.aiOverviews[0];
  if (r.aiOverviews) return r.aiOverviews;
  return undefined;
}

const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } };

/** SERP overlap: for a topic, which competitor URLs rank in top-10 and is Edstellar there? */
export interface SerpOverlapResult {
  topic: string;
  organic: { rank: number; url: string; domain: string; title: string; isEdstellar: boolean; isKnown: boolean }[];
  edstellarRank: number | null;
  edstellarUrl: string | null;
  competitorsInTop10: string[];
  /** Google AI Overview citations for this query, if Google surfaced one. */
  aiOverview: {
    summary: string;
    citations: { domain: string; url: string; title: string; isEdstellar: boolean; isKnown: boolean }[];
    edstellarCited: boolean;
  } | null;
  /** Questions Google considers related (PAA box). Used to seed the
   *  'Questions to address' section of writer briefs (#39). */
  peopleAlsoAsk: { question: string; snippet?: string }[];
  /** Featured snippet / answer box, if present. */
  answerBox: { title?: string; link?: string; snippet?: string } | null;
}
export async function serpOverlap(topic: string): Promise<SerpOverlapResult> {
  const res = await serperSearch(topic, 10);
  const organic = res.organic ?? [];
  // Audit H12 (Session 6): the previous `domainOf(o.link).includes("edstellar")`
  // also matched legitimate-competitor URLs containing the substring
  // (e.g. `edstellar-comparison.example.com`). Use isEdstellarDomain to
  // match the exact root domain like the main competitors module already does.
  const list = organic.map((o, i) => ({
    rank: o.position ?? i + 1,
    url: o.link,
    domain: domainOf(o.link),
    title: o.title,
    isEdstellar: isEdstellarDomain(domainOf(o.link)),
    isKnown: KNOWN_COMPETITORS.includes(domainOf(o.link)),
  }));
  const eds = list.find((r) => r.isEdstellar);
  const compDomains = Array.from(new Set(list.filter((r) => !r.isEdstellar).map((r) => r.domain)));

  const ai = pickAiOverview(res);
  const aiOverview = ai
    ? {
        summary: ai.summary ?? "",
        citations: (ai.citations ?? [])
          .filter((c) => !!c.link)
          .map((c) => ({
            domain: domainOf(c.link!),
            url: c.link!,
            title: c.title ?? c.snippet ?? c.link!,
            isEdstellar: isEdstellarDomain(domainOf(c.link!)),
            isKnown: KNOWN_COMPETITORS.includes(domainOf(c.link!)),
          })),
        edstellarCited: (ai.citations ?? []).some(
          (c) => !!c.link && isEdstellarDomain(domainOf(c.link)),
        ),
      }
    : null;

  const peopleAlsoAsk = (res.peopleAlsoAsk ?? [])
    .filter((p) => p.question && p.question.trim().length > 0)
    .map((p) => ({ question: p.question!.trim(), snippet: p.snippet?.trim() }))
    .slice(0, 8);

  return {
    topic,
    organic: list,
    edstellarRank: eds?.rank ?? null,
    edstellarUrl: eds?.url ?? null,
    competitorsInTop10: compDomains,
    aiOverview,
    peopleAlsoAsk,
    answerBox: res.answerBox ?? null,
  };
}

/**
 * Domain comparison: how many top-10 placements each competitor has across
 * a list of topics (vs Edstellar). Free-tier-friendly: cap topics at 8.
 */
export interface DomainCompareRow { domain: string; appearances: number; topRank: number | null }
export async function domainCompare(topics: string[]): Promise<{ topics: string[]; rows: DomainCompareRow[] }> {
  const trimmed = topics.slice(0, 8);
  const all = await Promise.all(
    trimmed.map((t) =>
      serperSearch(t, 10).catch(() => ({ organic: [] } as SerperResponse)),
    ),
  );
  const tally = new Map<string, { count: number; topRank: number | null }>();
  for (const resp of all) {
    (resp.organic ?? []).forEach((o, i) => {
      const d = domainOf(o.link);
      if (!d) return;
      const e = tally.get(d) ?? { count: 0, topRank: null };
      e.count++;
      e.topRank = e.topRank == null ? i + 1 : Math.min(e.topRank, i + 1);
      tally.set(d, e);
    });
  }
  const rows: DomainCompareRow[] = [...tally.entries()]
    .map(([domain, v]) => ({ domain, appearances: v.count, topRank: v.topRank }))
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 25);
  return { topics: trimmed, rows };
}

/**
 * Content-freshness audit: pull a competitor's sitemap and report
 * how fresh / how many URLs they have, vs Edstellar's known sitemap-size.
 */
export interface FreshnessResult {
  domain: string;
  totalUrls: number;
  /** From sitemap <lastmod> — useful for "how big a site is" but unreliable as
   *  a freshness signal (WordPress/HubSpot regenerate it on every rebuild). */
  recent90d: number;
  /** Audit 10C (Session 8): same window, but verified by sampling N pages
   *  and reading their on-page `article:modified_time` / `<time>` instead
   *  of trusting the sitemap. Null if the sample didn't yield enough
   *  signal (sample size 0 or every page returned no metadata). */
  recent90dVerified: number | null;
  verifiedSampleSize: number;
  oldest: string | null;
  newest: string | null;
  sample: { url: string; lastmod: string; onPageModified?: string | null }[];
}
export async function competitorFreshness(domain: string): Promise<FreshnessResult> {
  const root = domain.startsWith("http") ? domain : `https://${domain}`;
  const candidates = [
    `${root}/sitemap.xml`,
    `${root}/sitemap_index.xml`,
    `${root}/sitemap-index.xml`,
  ];
  let xml = "";
  let chosen = "";
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) { xml = await res.text(); chosen = url; break }
    } catch { /* try next */ }
  }
  if (!xml) throw new Error(`Could not fetch sitemap for ${domain}.`);
  // If it's a sitemap index, follow the first child.
  if (/<sitemapindex/i.test(xml)) {
    const first = xml.match(/<loc>([^<]+)<\/loc>/i)?.[1];
    if (first) {
      try {
        const r2 = await fetch(first, { signal: AbortSignal.timeout(15_000) });
        if (r2.ok) xml = await r2.text();
      } catch { /* fallthrough */ }
    }
  }
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => {
    const block = m[1];
    return {
      url: (block.match(/<loc>([^<]+)<\/loc>/i)?.[1] ?? "").trim(),
      lastmod: (block.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1] ?? "").trim().slice(0, 10),
    };
  }).filter((e) => e.url);

  const now = Date.now();
  const recent90d = entries.filter((e) => {
    if (!e.lastmod) return false;
    const t = Date.parse(e.lastmod);
    return !isNaN(t) && now - t < 90 * 86_400_000;
  }).length;
  const dates = entries.map((e) => e.lastmod).filter(Boolean).sort();

  // Audit 10C (Session 8): sitemap <lastmod> lies for WordPress, HubSpot,
  // and any CMS that regenerates the sitemap on every rebuild. Sample
  // up to FRESHNESS_SAMPLE pages, read their on-page `article:modified_time`
  // / `<time>` / og:updated_time, and compute a verified recent-90d
  // ratio that can be extrapolated to the whole sitemap.
  const FRESHNESS_SAMPLE = 12;
  const FRESHNESS_CONCURRENCY = 4;
  const sampleEntries = entries.slice(0, FRESHNESS_SAMPLE);
  let sampleHits = 0;
  let sampleRecent = 0;
  const enriched: { url: string; lastmod: string; onPageModified?: string | null }[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < sampleEntries.length) {
      const i = cursor++;
      const e = sampleEntries[i];
      if (!e) continue;
      try {
        const onPage = await fetchOnPageModified(e.url);
        if (onPage) {
          sampleHits++;
          if (now - Date.parse(onPage) < 90 * 86_400_000) sampleRecent++;
        }
        enriched.push({ ...e, onPageModified: onPage });
      } catch {
        enriched.push({ ...e, onPageModified: null });
      }
    }
  }
  await Promise.all(
    Array.from({ length: FRESHNESS_CONCURRENCY }, () => worker()),
  );

  let recent90dVerified: number | null = null;
  if (sampleHits >= 3) {
    const verifiedRatio = sampleRecent / sampleHits;
    recent90dVerified = Math.round(verifiedRatio * entries.length);
  }

  return {
    domain,
    totalUrls: entries.length,
    recent90d,
    recent90dVerified,
    verifiedSampleSize: sampleHits,
    oldest: dates[0] ?? null,
    newest: dates[dates.length - 1] ?? null,
    sample: enriched.length ? enriched : entries.slice(0, FRESHNESS_SAMPLE),
  };
}

/**
 * Pull the most reliable on-page "modified" timestamp from a page.
 * Returns the first match in priority order:
 *   1. <meta property="article:modified_time"> (most common; WP, Yoast, etc.)
 *   2. <meta property="og:updated_time">
 *   3. <time itemprop="dateModified" datetime="…"> or <time datetime="…">
 *   4. <meta name="last-modified">
 * Returns null when nothing parseable is found. Lightweight — no DOM parse,
 * just regex over the first ~256 KB of HTML.
 */
async function fetchOnPageModified(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 256_000);
    const candidates: (string | undefined)[] = [
      html.match(/<meta[^>]+(?:property|name)=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i)?.[1],
      html.match(/<meta[^>]+(?:property|name)=["']og:updated_time["'][^>]+content=["']([^"']+)["']/i)?.[1],
      html.match(/<time[^>]+(?:itemprop=["']dateModified["'][^>]+)?datetime=["']([^"']+)["']/i)?.[1],
      html.match(/<meta[^>]+name=["']last-modified["'][^>]+content=["']([^"']+)["']/i)?.[1],
    ];
    for (const c of candidates) {
      if (!c) continue;
      const t = Date.parse(c);
      if (!Number.isNaN(t)) return new Date(t).toISOString();
    }
    return null;
  } catch {
    return null;
  }
}
