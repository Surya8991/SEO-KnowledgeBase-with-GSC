/**
 * Auth proxy (Next 16 file convention; replaces the deprecated middleware.ts)
 * — NextAuth v5.
 *
 * Behaviour controlled by AUTH_ENABLED env var:
 *   - unset / false  → proxy does nothing; site is open (current state).
 *   - true           → every dashboard route AND every /api/* route except
 *                       /api/auth/*, the public icon/manifest routes, and
 *                       the cron + webhook endpoints is gated; unauth'd
 *                       requests get a redirect to /signin (HTML) or 401
 *                       (API).
 *
 * Public-from-cron routes:
 *   - /api/cron/* keep their own CRON_SECRET bearer check.
 *   - /api/check + /api/check/bulk keep their own WEBHOOK_API_KEY check.
 *   - /api/icon, /api/apple-icon, /api/opengraph-image, /robots.txt,
 *     /manifest.webmanifest stay open (Next file-conventions).
 */
import { NextResponse } from "next/server";
import { auth, isAuthEnabled } from "@/auth";

/**
 * Public-path contract — audit S5/H2 (Session 6).
 *
 * Each entry is matched as either an exact path (`pathname === entry`) or as
 * a strict prefix (`pathname.startsWith(entry + "/")`). The trailing slash is
 * IMPORTANT: without it, `"/api/auth"` would also bypass auth for any future
 * route whose name starts with that string (e.g. `/api/authentication-overview`),
 * and `"/api/check"` would bypass `/api/checkx`. Anchor every prefix.
 */
const PUBLIC_PATHS = [
  "/signin",
  "/api/auth",            // NextAuth handlers (subroutes match via prefix rule)
  "/api/cron",            // each cron route enforces its own CRON_SECRET
  "/api/check",           // protected by WEBHOOK_API_KEY when set; rate-limited otherwise
  "/api/check/bulk",
  "/api/drafts",          // routes enforce WORKER_API_KEY (worker) OR session (UI) internally
  "/api/summarize",       // gated by WEBHOOK_API_KEY + rate-limit (audit S3, Batch 1B)
  "/api/rewrite-suggestion", // gated by WEBHOOK_API_KEY + rate-limit (audit S3, Batch 1B)
  "/icon",
  "/apple-icon",
  "/opengraph-image",
  "/robots.txt",
  "/manifest.webmanifest",
  "/brand",               // public/brand/* — logos used on the sign-in page itself
];

function isPublicPath(pathname: string): boolean {
  for (const entry of PUBLIC_PATHS) {
    if (pathname === entry) return true;
    if (pathname.startsWith(entry + "/")) return true;
  }
  return false;
}

/**
 * Audit H2 — replaced the wide `\.[a-z0-9]{2,6}$/i` regex with an explicit
 * allow-list of common static-asset extensions so future routes like
 * `/api/export.json` or `/dashboard/report.pdf` do not silently become public.
 */
const STATIC_ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|css|js|map|txt|xml)$/i;

/**
 * Audit 10C CSRF guard (Session 8): SameSite=Lax cookies (NextAuth's
 * default) already block cross-site POSTs in modern browsers, but old
 * Safari + a few edge cases let an attacker's page POST to /api/* with
 * the user's session cookie attached. This origin check is the
 * belt-and-braces layer:
 *
 *   - State-changing methods (POST / PUT / PATCH / DELETE) must carry
 *     an Origin header matching the request host. Same-origin browser
 *     POSTs always do; cross-site attacker POSTs don't, with the
 *     exception of HTML form posts that omit Origin entirely on some
 *     legacy browsers — we accept null Origin only when Referer matches.
 *   - Read methods (GET/HEAD/OPTIONS) are unaffected.
 *   - The proxy only runs when AUTH_ENABLED=true, so unauth'd webhook
 *     posters (CMS hooks for /api/check etc.) don't trip the check.
 */
const STATEFUL_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originMatchesHost(req: { headers: Headers; nextUrl: URL }): boolean {
  const origin = req.headers.get("origin");
  const expectedHost = req.nextUrl.host;
  if (origin) {
    try {
      return new URL(origin).host === expectedHost;
    } catch {
      return false;
    }
  }
  // Some legacy clients omit Origin on same-origin posts; fall back to Referer.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === expectedHost;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer = no way to verify; reject for state-changing reqs.
  return false;
}

export default auth((req) => {
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (STATIC_ASSET_RE.test(pathname)) return NextResponse.next();

  if (req.auth) {
    // Authed; enforce CSRF origin check on mutating methods.
    if (STATEFUL_METHODS.has(req.method) && !originMatchesHost(req)) {
      return NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  // API requests: return 401 instead of redirecting to HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL("/signin", req.nextUrl);
  url.searchParams.set("returnTo", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  // Match everything except Next's static assets + _next internal routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
