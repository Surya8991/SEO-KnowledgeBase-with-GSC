import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt these out of Next's Server Components bundler — load them at runtime
  // via native `require` instead. @xenova/transformers, jsdom, and
  // onnxruntime-node are already on Next 16's default opt-out list but listing
  // them explicitly documents the dependency and is harmless. cheerio and
  // googleapis are NOT on the default list.
  // Docs: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-node",
    "jsdom",
    "cheerio",
    "googleapis",
  ],

  // Ship runtime assets that @vercel/nft's static analyzer cannot trace:
  //   - data/**/*           — lib/sitemap.ts + lib/taxonomy.ts + lib/gsc-insights.ts
  //                            do readFileSync(join(process.cwd(),"data",…)) at runtime;
  //                            the dynamic path means nft never sees these files.
  //   - onnxruntime-node    — native .node + libonnxruntime.so binaries that
  //                            @xenova/transformers loads via dlopen; nft sees
  //                            the JS but not the platform binaries it picks at
  //                            runtime. Without this Vercel returns
  //                            "libonnxruntime.so.1.14.0: cannot open shared object file"
  //                            on every /api/check call.
  //   - @xenova/transformers tokenizer/config JSON — same problem, the loader
  //                            reads model JSON via dynamic paths.
  // Applied to /* (all routes) for simplicity; the trace cost is dominated by
  // the binaries which are <100MB and only counted once per function.
  // Docs: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
  outputFileTracingIncludes: {
    "/*": [
      "data/**/*",
      "node_modules/onnxruntime-node/bin/**/*",
      "node_modules/@xenova/transformers/**/*.json",
    ],
  },

  /**
   * Audit H1 (Session 6): basic security headers. CSP is intentionally
   * permissive — Tailwind v4 emits inline `<style>` blocks and Next 16
   * server-component runtime needs `unsafe-inline` for streaming scripts.
   * A nonce-based strict CSP is a separate project (tracked as a follow-up).
   *
   * Frame-ancestors 'none' is set both via CSP and X-Frame-Options for
   * legacy clients. HSTS sets a 2-year max-age with preload-eligible
   * directives; once stable in prod, submit to hstspreload.org.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
      /**
       * Audit 10C polish (Session 8): the generated OG image and favicon
       * routes are public per Next file-conventions. Without a long
       * Cache-Control, any DoS that hammers them re-runs the image
       * generator on every request. These outputs change only when we
       * redeploy; let Vercel's edge cache hold them for a day with a
       * week-long stale-while-revalidate so a stampede serves cache.
       */
      {
        source: "/(opengraph-image|icon|apple-icon)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
