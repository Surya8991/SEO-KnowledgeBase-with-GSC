"use client";

/**
 * Audit S7 (Session 6): dashboard error boundary. Before this, a single
 * failed SQL call inside app/(dashboard)/page.tsx crashed the whole shell
 * to the default Next error page. Now any thrown error inside the segment
 * renders this card with a Retry CTA that calls Next's reset().
 */
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard segment error:", error);
  }, [error]);

  return (
    <div className="p-8">
      <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-red-900">
          Something broke while loading this view.
        </h2>
        <p className="mt-2 text-sm text-red-800">
          The dashboard hit an error and could not finish rendering. This is
          almost always a transient database hiccup. Try again — if it keeps
          happening, share the digest below with the engineering team.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-red-700">
            digest: {error.digest}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
          >
            Retry
          </button>
          <a
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
