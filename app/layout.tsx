import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  "https://edstellar-conflict-checker-knowledg.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(APP_BASE_URL),
  title: {
    default: "Edstellar Conflict Checker",
    // Per-page titles set via `export const metadata` on a route become
    // "Page Name · Edstellar Conflict Checker".
    template: "%s · Edstellar Conflict Checker",
  },
  description:
    "Pre-publish SEO duplication + cannibalization detector for Edstellar content. URL or topic → 0–100 conflict score against the live corpus, with GSC performance and competitor research.",
  applicationName: "Edstellar Conflict Checker",
  authors: [{ name: "Edstellar" }],
  // Audit 10C polish (Session 8): dropped <meta name="keywords"> — Google
  // ignored it since 2009 and the dashboard is `index: false` anyway, so
  // there's no audience for it.
  // Internal tool — explicitly tell search engines to skip it.
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Edstellar Conflict Checker",
    title: "Edstellar Conflict Checker",
    description:
      "Pre-publish SEO duplication + cannibalization detector. URL/topic → scored matches against the live corpus.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Edstellar Conflict Checker",
    description:
      "Pre-publish SEO duplication + cannibalization detector for Edstellar content.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
