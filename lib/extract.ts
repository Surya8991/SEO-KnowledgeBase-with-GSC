import * as cheerio from "cheerio";
import { assertSafeOutboundUrl } from "./ssrf-guard";

export interface ExtractedPage {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  contentText: string;
  /** <link rel="canonical" href=""> if present. Surfaces canonical-tag bugs
   *  in the audit view (#32). */
  canonicalUrl: string | null;
  /** Total <img> tag count and how many are missing or have empty alt text.
   *  Surfaces image-SEO debt in the audit view (#41). */
  imageCount: number;
  imagesNoAlt: number;
}

/**
 * Selectors for chrome / boilerplate that must not pollute the embedding.
 * Anything that matches is dropped from the document BEFORE we pick a content
 * root, and again from inside the chosen root (in case it's nested).
 *
 * Rules of thumb when adding here:
 *   - Be specific. Substring matches like [class*="ad"] would eat `.heading`,
 *     `.shadow`, `.padding` — never add a 2-char fragment.
 *   - Prefer ARIA roles when available; they're load-bearing on accessible sites.
 *   - If something is editorially debatable (e.g. table of contents), leave it.
 */
const NOISE_SELECTORS = [
  // Structural / non-content nodes
  "script", "style", "noscript", "template", "svg", "iframe", "form", "button",
  "link", "meta",

  // Page chrome (semantic)
  "nav", "header", "footer", "aside",

  // Page chrome (ARIA)
  "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  "[role='complementary']", "[role='search']", "[role='dialog']",
  "[role='alertdialog']", "[role='tablist']",

  // Hidden
  "[aria-hidden='true']", "[hidden]",
  "[style*='display:none']", "[style*='display: none']",
  "[style*='visibility:hidden']", "[style*='visibility: hidden']",

  // Sidebars
  "[class*='sidebar']", "[id*='sidebar']", "[class*='side-bar']",

  // Related / recommended / "you may also like"
  "[class*='related']", "[id*='related']",
  "[class*='recommend']", "[id*='recommend']",
  "[class*='you-may-like']", "[class*='you-might']", "[class*='also-read']",
  "[class*='read-more']", "[class*='read-next']", "[class*='up-next']",
  "[class*='similar-post']", "[class*='similar-article']",
  "[class*='popular-post']", "[class*='trending']",
  "[class*='more-from']",

  // Comments
  "[class*='comment']", "[id*='comment']",
  "[class*='disqus']", "[id*='disqus']",

  // Social share buttons (not "social proof" testimonials — be specific)
  "[class*='share-button']", "[class*='share-bar']", "[class*='share-widget']",
  "[class*='social-share']", "[class*='sharing']",
  "[class*='addthis']", "[class*='sharethis']",

  // Breadcrumbs
  "[class*='breadcrumb']", "[id*='breadcrumb']",
  "[aria-label*='breadcrumb' i]",

  // Author boxes / bios
  "[class*='author-bio']", "[class*='author-box']", "[class*='about-author']",
  "[class*='author-card']", "[class*='byline']",

  // Newsletter / CTA / lead-gen embedded inside the post
  "[class*='newsletter']", "[class*='subscribe']", "[class*='signup']",
  "[class*='cta-box']", "[class*='cta-banner']", "[class*='cta-block']",
  "[class*='lead-magnet']",

  // Popups / modals / lightboxes
  "[class*='popup']", "[id*='popup']",
  "[class*='modal']", "[id*='modal']",
  "[class*='lightbox']", "[class*='overlay']",
  "[class*='exit-intent']",

  // Cookie / consent / GDPR banners
  "[class*='cookie']", "[id*='cookie']",
  "[class*='consent']", "[id*='consent']",
  "[class*='gdpr']", "[class*='ccpa']",

  // Ads (anchor on multi-word fragments only — never bare "ad")
  "[class*='advertisement']", "[class*='ad-slot']", "[class*='ad-banner']",
  "[class*='banner-ad']", "[class*='sponsored']", "[id*='google_ads']",

  // Tag clouds / category chips at post bottom
  "[class*='tag-list']", "[class*='tag-cloud']", "[class*='post-tags']",
  "[class*='entry-tags']",

  // Misc UI
  "[class*='skip-link']", "[class*='skip-to']",
  "[class*='back-to-top']", "[class*='scroll-to-top']",
  "[class*='reading-progress']",
  "[class*='floating-cta']", "[class*='sticky-cta']",
  "[class*='print-only']", "[class*='no-print']",

  // ----- Edstellar-theme specific -----
  // Found by auditing live /blog/* HTML; class names are unique enough
  // that an exact-substring match is safe. Group kept separate so future
  // theme audits can extend it without touching the generic list above.
  "[class*='blog-tag-block']",                              // 'BLOG' pill header
  "[class*='update-date']",                                 // 'Updated On <date> 8 mins read' meta
  "[class*='bog-index']", "[class*='blog-index']",          // ToC widget (theme typo: "bog")
  "[class*='share-wrapper']", "[class*='share-article']",   // share row + share footer
  "[class*='share-footer']", "[class*='share-text']",
  "[class*='authors-block']", "[class*='blog-author']",     // author byline blocks
  "[class*='authors-footer']",
];

/**
 * In order: try the most specific blog/article container first, fall back to
 * progressively more generic ones, and only land on <body> as a last resort.
 *
 * A candidate only counts if its post-noise-strip text is at least
 * MIN_ROOT_CHARS long — protects against empty <article> shells.
 */
const ROOT_CANDIDATES = [
  "article",
  "[itemprop='articleBody']",
  "[itemtype$='Article']",
  "[itemtype$='BlogPosting']",
  ".post-content", ".entry-content", ".blog-content",
  ".article-content", ".article-body", ".post-body",
  ".story-body", ".rich-text", ".prose",
  ".content-area", ".main-content", "#content", "#main-content",
  "main",
  "body",
];

const MIN_ROOT_CHARS = 200;

/**
 * Fetch a URL and extract its main textual content for embedding/summarizing.
 *
 * Audit S3 (Session 6): user-supplied URLs are validated through the SSRF
 * guard BEFORE the fetch — private/loopback/link-local/cloud-metadata IPs are
 * rejected. Redirects are followed manually so each hop is re-validated; the
 * default `redirect: "follow"` would allow a public host to 302→169.254.169.254.
 */
const MAX_REDIRECTS = 5;

export async function fetchAndExtract(
  url: string,
  timeoutMs = 20000,
): Promise<ExtractedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = url;
    let html: string | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertSafeOutboundUrl(currentUrl);
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; EdstellarConflictChecker/1.0; +https://www.edstellar.com)",
          accept: "text/html",
        },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) throw new Error(`Redirect without location at ${currentUrl}`);
        currentUrl = new URL(next, currentUrl).toString();
        continue;
      }
      if (!res.ok) throw new Error(`Fetch ${currentUrl} → ${res.status}`);
      html = await res.text();
      break;
    }
    if (html === null) throw new Error(`Too many redirects fetching ${url}`);
    return extractFromHtml(currentUrl, html);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse already-fetched HTML into a clean ExtractedPage.
 *
 * Strategy:
 *   1. Read title / meta description / h1 from <head> + first <h1>.
 *   2. Strip every noise selector from the whole document.
 *   3. Pick the most specific content root that has real text in it
 *      (article > schema-tagged > known content classes > main > body).
 *   4. Strip noise *again* from inside the chosen root — related-posts
 *      blocks frequently live inside <article>.
 *   5. Return whitespace-normalised text.
 */
export function extractFromHtml(url: string, html: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    null;
  const metaDescription =
    $("meta[name='description']").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    null;
  const h1 = $("h1").first().text().trim() || null;
  const canonicalUrl = $("link[rel='canonical']").attr("href")?.trim() || null;

  // Image SEO: count all <img> + how many have no alt (or alt="").
  // Done BEFORE the noise strip so we count images inside content (.post-img)
  // not just hero/decorative ones.
  let imageCount = 0;
  let imagesNoAlt = 0;
  $("img").each((_, el) => {
    imageCount++;
    const alt = $(el).attr("alt");
    if (!alt || !alt.trim()) imagesNoAlt++;
  });

  const noise = NOISE_SELECTORS.join(",");
  $(noise).remove();

  let root: cheerio.Cheerio<any> | null = null;
  for (const sel of ROOT_CANDIDATES) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length >= MIN_ROOT_CHARS) {
      root = el;
      break;
    }
  }
  if (!root) root = $("body");

  root.find(noise).remove();

  const contentText = normalizeWhitespace(root.text());

  return { url, title, metaDescription, h1, contentText, canonicalUrl, imageCount, imagesNoAlt };
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Rough token estimate (~4 chars/token) for cost/limit awareness. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Derive a content_type from an Edstellar URL path. */
export function classifyUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path === "/" || path === "") return "page";
    if (path.startsWith("/blog")) return "blog";
    if (path.includes("category") || path.includes("training-programs"))
      return "category";
    // Course detail pages on Edstellar are typically deep single-segment slugs
    // ending in "-training" / "-course"; treat the rest as generic pages.
    if (path.includes("-training") || path.includes("-course")) return "course";
    return "page";
  } catch {
    return "page";
  }
}
