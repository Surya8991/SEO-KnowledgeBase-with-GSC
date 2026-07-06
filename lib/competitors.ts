import { neon } from "@neondatabase/serverless";
import { getChat } from "@/lib/ai";
import { fetchAndExtract } from "@/lib/extract";
import { log } from "@/lib/logger";

// Corporate-training competitors Edstellar benchmarks against (from the hub).
export const KNOWN_COMPETITORS = [
  "skillsoft.com",
  "linkedin.com",
  "dalecarnegie.com",
  "kornferry.com",
  "pluralsight.com",
  "oreilly.com",
  "ideou.com",
  "td.org",
  "coachfederation.org",
  "udemy.com",
  "coursera.org",
  "edx.org",
];

export interface CompetitorResult {
  url: string;
  title: string;
  domain: string;
  summary: string;
  angle: string;
  isKnownCompetitor: boolean;
  source: string;
}

interface SerpOrganic {
  title: string;
  link: string;
  snippet?: string;
}

/** Google SERP via Serper.dev (set SERPER_API_KEY). Returns organic results. */
async function serperSearch(query: string, num = 10): Promise<SerpOrganic[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error(
      "SERPER_API_KEY is not set. Add a free key from https://serper.dev to enable competitor SERP lookups.",
    );
  }
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) throw new Error(`Serper search failed: ${res.status}`);
  const json = (await res.json()) as { organic?: SerpOrganic[] };
  return json.organic ?? [];
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Exact root-domain match: 'edstellar.com' or any subdomain. Previously
 *  `includes("edstellar")` would also drop legitimate competitor pages whose
 *  URLs happened to contain the substring (e.g. "edstellar-comparison" posts). */
export function isEdstellarDomain(d: string): boolean {
  return d === "edstellar.com" || d.endsWith(".edstellar.com");
}

/**
 * Audit H13 (Session 6): the previous `${topic} corporate training` suffix
 * wrecked SERP relevance when the topic already named a training format
 * (e.g. `"leadership coaching for managers corporate training"`). Only
 * append the suffix when the topic doesn't already include a
 * training-related term. Exported so callers in competitors-extra and
 * other modules use the same logic.
 */
const TRAINING_TERMS_RE =
  /\b(training|course|coaching|workshop|certification|bootcamp|class|tutorial|program|programme|seminar|webinar)\b/i;

export function widenForCorporateTraining(topic: string): string {
  if (TRAINING_TERMS_RE.test(topic)) return topic;
  return `${topic} corporate training`;
}

/**
 * SERP-noise destinations: video pages, social, Q&A / forums, file shares.
 * These rank for B2B training queries but have no useful text to summarize —
 * the extractor would return a video-player shell or user-generated chatter.
 */
const NOISE_DOMAINS = new Set([
  "youtube.com", "youtu.be", "m.youtube.com",
  "vimeo.com",
  "facebook.com", "m.facebook.com",
  "twitter.com", "x.com", "t.co",
  "instagram.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "slideshare.net",
  "scribd.com",
  "issuu.com",
  "amazon.com",
]);
const NOISE_PATH_EXTENSIONS = /\.(?:pdf|doc|docx|ppt|pptx|xls|xlsx|zip)$/i;

function isNoiseDestination(url: string): boolean {
  if (NOISE_PATH_EXTENSIONS.test(url)) return true;
  const d = domainOf(url);
  if (!d) return true;
  return NOISE_DOMAINS.has(d);
}

/** Research competitors for a topic: SERP → filter → summarize top results. */
export async function researchCompetitors(
  topic: string,
  opts: { limit?: number; persist?: boolean } = {},
): Promise<CompetitorResult[]> {
  const limit = opts.limit ?? 6;
  const chat = getChat();

  // Ask for more than we need — Edstellar + noise + per-domain dedup eats
  // most of the first page on corporate-training queries. Audit H13: only
  // widen with "corporate training" when the topic doesn't already include
  // a training-related term — otherwise we double-up keywords and SERP
  // relevance collapses.
  const organic = await serperSearch(widenForCorporateTraining(topic), 20);

  // Skip Edstellar (exact-suffix), drop SERP-noise destinations, then keep
  // only the first result per domain — otherwise the top-N is often dominated
  // by one large site (oreilly.com, coursera.org) and we lose competitive
  // coverage.
  const seenDomains = new Set<string>();
  const filtered = organic
    .filter((o) => {
      const d = domainOf(o.link);
      if (!d || isEdstellarDomain(d)) return false;
      if (isNoiseDestination(o.link)) return false;
      if (seenDomains.has(d)) return false;
      seenDomains.add(d);
      return true;
    })
    .sort((a, b) => {
      const ak = KNOWN_COMPETITORS.includes(domainOf(a.link)) ? 0 : 1;
      const bk = KNOWN_COMPETITORS.includes(domainOf(b.link)) ? 0 : 1;
      return ak - bk;
    })
    .slice(0, limit);

  const results: CompetitorResult[] = [];
  for (const o of filtered) {
    const domain = domainOf(o.link);
    let summary = o.snippet ?? "";
    let angle = "";
    try {
      const page = await fetchAndExtract(o.link, 15000);
      const s = await chat.summarizeCompetitor({
        topic,
        url: o.link,
        title: o.title,
        content: [page.title, page.h1, page.contentText].filter(Boolean).join("\n"),
      });
      summary = s.summary || summary;
      angle = s.angle;
    } catch {
      // Keep SERP snippet if the page can't be fetched/summarized.
    }
    results.push({
      url: o.link,
      title: o.title,
      domain,
      summary,
      angle,
      isKnownCompetitor: KNOWN_COMPETITORS.includes(domain),
      source: "serper",
    });
  }

  if (opts.persist !== false && process.env.DATABASE_URL) {
    try {
      const sql = neon(process.env.DATABASE_URL);
      for (const r of results) {
        await sql.query(
          `INSERT INTO competitors (topic, competitor_url, title, summary, domain, is_known_competitor, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [topic, r.url, r.title, `${r.summary}\n\nDifferentiation: ${r.angle}`, r.domain, r.isKnownCompetitor ? 1 : 0, r.source],
        );
      }
    } catch (e) {
      log.warn("competitors persist failed", { error: (e as Error).message });
    }
  }

  return results;
}
