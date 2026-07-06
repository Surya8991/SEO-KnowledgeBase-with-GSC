import { ImageResponse } from "next/og";

// Open Graph + Twitter card image — what shows up when someone pastes a
// link to this app into Slack, LinkedIn, X, etc. 1200x630 is the canonical
// OG card dimension.

export const runtime = "edge";
export const alt = "Edstellar Conflict Checker — pre-publish SEO duplication detector";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "radial-gradient(ellipse at top left, #1f2747 0%, #0b1020 60%)",
          color: "#e7ecf5",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, #7c9cff, #22d3ee)",
              color: "#0b1020",
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: -2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            CC
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 24, color: "#9aa6c2", letterSpacing: 1 }}>
              EDSTELLAR
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: -4 }}>
              Content Intelligence
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            Conflict Checker
          </div>
          <div style={{ fontSize: 30, color: "#9aa6c2", lineHeight: 1.4, maxWidth: 900 }}>
            Detect duplication &amp; SEO cannibalization before publishing.
            URL or topic → 0–100 conflict score against the live corpus.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 20, color: "#a5b4fc" }}>
          <span
            style={{
              padding: "8px 14px",
              border: "1px solid rgba(124,156,255,.4)",
              borderRadius: 999,
              background: "rgba(124,156,255,.08)",
            }}
          >
            pgvector
          </span>
          <span
            style={{
              padding: "8px 14px",
              border: "1px solid rgba(34,211,238,.4)",
              borderRadius: 999,
              background: "rgba(34,211,238,.08)",
            }}
          >
            LLM judge
          </span>
          <span
            style={{
              padding: "8px 14px",
              border: "1px solid rgba(52,211,153,.4)",
              borderRadius: 999,
              background: "rgba(52,211,153,.08)",
              color: "#86efac",
            }}
          >
            GSC + Serper
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      // Audit 10C (Session 8): ImageResponse defaults to max-age=0. Override
      // so the rendered OG image lives at Vercel's edge for 24h with a 7-day
      // stale-while-revalidate. The image only changes on redeploy.
      // next.config.ts headers() can't reach this — ImageResponse owns its
      // response object.
      headers: {
        "cache-control":
          "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
