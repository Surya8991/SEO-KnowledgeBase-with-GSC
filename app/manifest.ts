import type { MetadataRoute } from "next";

// Web app manifest — lets the app be "installed" to a phone home screen or
// macOS dock, and gives the browser theme color / display hints. Internal
// tool, so we keep it minimal.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Edstellar Conflict Checker",
    short_name: "Conflict Checker",
    description:
      "Pre-publish SEO duplication + cannibalization detector for Edstellar content.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1020",
    theme_color: "#0b1020",
    icons: [
      // File-based icons in app/ — Next 16 mounts these at /icon.svg and
      // /apple-icon.png respectively.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "256x256", type: "image/png" },
    ],
  };
}
