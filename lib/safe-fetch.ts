/**
 * SSRF-safe fetch for user-supplied URLs (audit C1, Session 11).
 *
 * Every hop is validated through `assertSafeOutboundUrl` BEFORE the request
 * goes out, and redirects are followed MANUALLY so a public host cannot
 * 302 → 169.254.169.254 (cloud metadata) / RFC1918 / loopback. This is the
 * same loop `lib/extract.ts#fetchAndExtract` uses; it lives here so every
 * user-URL fetcher (competitor sitemaps, freshness sampler, sitemap-drift)
 * shares one hardened implementation instead of calling raw `fetch`.
 *
 * Throws SsrfBlockedError (from the guard) on a forbidden target, or a plain
 * Error on redirect loops — callers surface these as a 4xx/5xx.
 */
import { assertSafeOutboundUrl } from "@/lib/ssrf-guard";

const MAX_REDIRECTS = 5;

export interface SafeFetchResult {
  res: Response;
  /** The final URL after following validated redirects. */
  finalUrl: string;
}

export interface SafeFetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
}

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOpts = {},
): Promise<SafeFetchResult> {
  const { timeoutMs = 15_000, headers, method = "GET" } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertSafeOutboundUrl(currentUrl);
      const res = await fetch(currentUrl, {
        method,
        headers,
        signal: controller.signal,
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) throw new Error(`Redirect without location at ${currentUrl}`);
        currentUrl = new URL(next, currentUrl).toString();
        continue;
      }
      return { res, finalUrl: currentUrl };
    }
    throw new Error(`Too many redirects fetching ${rawUrl}`);
  } finally {
    clearTimeout(timer);
  }
}
