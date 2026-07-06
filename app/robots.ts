import type { MetadataRoute } from "next";

// Internal tool — block all crawlers. There's no public content here that
// should be indexed; the dashboard is auth-adjacent (writes to a shared DB)
// and the OG image is the only public-facing artifact.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
