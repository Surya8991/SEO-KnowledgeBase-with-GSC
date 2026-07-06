import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

/**
 * URL patterns we never want in the conflict-checker corpus.
 *
 * Why: ingesting these pollutes vector search with pages that aren't
 * original content. The two worst offenders are:
 *   - Tag / category / author archive pages — they re-list other posts'
 *     titles + snippets, so they always look ~70% similar to whatever the
 *     candidate is about, generating false-positive conflicts.
 *   - Utility URLs (sitemap itself, search, login, cart, checkout) —
 *     either no content or no SEO surface.
 *
 * Pagination is also dropped: `/blog/page/2/` is the same set of titles
 * as `/blog/` with different ordering, so it duplicates signal.
 */
const JUNK_URL_PATTERNS: RegExp[] = [
  /\/sitemap(?:\.|\/|$)/i,               // /sitemap, /sitemap.xml, /sitemap/
  /\/tag\//i,                            // /tag/<slug> archive pages
  /\/author\//i,
  /\/archive(?:s)?\//i,
  /\/page\/\d+/i,                        // /blog/page/2
  /\/feed\/?$/i,
  /\/wp-(?:admin|login|json|content\/uploads)/i,
  /\/search(?:\/|\?|$)/i,
  /\/login\/?$/i, /\/logout\/?$/i,
  /\/cart\/?$/i, /\/checkout\/?$/i, /\/account\/?$/i, /\/my-account/i,
  /\.(?:xml|pdf|zip|doc|docx|ppt|pptx|xls|xlsx|csv|json|rss|atom)$/i,
  /\?(?:.*&)?(?:replytocom|share=|preview=)/i, // share/preview/comment-reply params
];

export function isJunkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const pathQuery = u.pathname + u.search;
    return JUNK_URL_PATTERNS.some((re) => re.test(pathQuery));
  } catch {
    return true;
  }
}

/**
 * Parse the bundled sitemap CSV (url,lastmod,sitemap). Minimal CSV reader
 * that handles the double-quoted fields in our export.
 *
 * Filters out junk URLs (see JUNK_URL_PATTERNS) by default. Pass
 * `{ includeJunk: true }` if you actually need the unfiltered list (e.g.
 * for an audit run that should HEAD-check everything).
 */
export function readSitemapCsv(
  pathOrOpts:
    | string
    | { path?: string; includeJunk?: boolean } = join(
    process.cwd(),
    "data",
    "sitemap-urls.csv",
  ),
): SitemapEntry[] {
  const path =
    typeof pathOrOpts === "string"
      ? pathOrOpts
      : pathOrOpts.path ?? join(process.cwd(), "data", "sitemap-urls.csv");
  const includeJunk =
    typeof pathOrOpts === "object" && pathOrOpts.includeJunk === true;

  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: SitemapEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const url = cols[0]?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (!includeJunk && isJunkUrl(url)) continue;
    out.push({ url, lastmod: cols[1]?.trim() || null });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
