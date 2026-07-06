"use client";

import { useEffect } from "react";

// Dropdown choices for every paginated table. Bumped up in Session 5 to
// reduce per-page clicking — most data-heavy views (audit, corpus, bulk
// check) now show 100 by default; users on small viewports can drop to 50.
export const DEFAULT_PAGE_SIZES = [50, 100, 200, 500];

export function Pagination({
  page,
  pageSize,
  total,
  onJump,
  onPageSize,
  pageSizes = DEFAULT_PAGE_SIZES,
  loading,
  unit = "items",
}: {
  page: number;
  pageSize: number;
  total: number;
  onJump: (p: number) => void;
  onPageSize?: (n: number) => void;
  pageSizes?: number[];
  loading?: boolean;
  unit?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Auto-reset when a filter shrinks `total` below the current page —
  // otherwise the caller has to remember to setPage(1) in every effect.
  useEffect(() => {
    if (page > totalPages) onJump(1);
  }, [page, totalPages, onJump]);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const can = (p: number) => p >= 1 && p <= totalPages && p !== page && !loading;
  const pages = pageWindow(page, totalPages);
  if (total <= pageSize && !onPageSize) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-slate-500">
        Showing <strong className="text-slate-700">{start.toLocaleString()}–{end.toLocaleString()}</strong>{" "}
        of <strong className="text-slate-700">{total.toLocaleString()}</strong> {unit}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600"
          >
            {pageSizes.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <Btn disabled={!can(1)} onClick={() => onJump(1)}>« First</Btn>
        <Btn disabled={!can(page - 1)} onClick={() => onJump(page - 1)}>‹ Prev</Btn>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={i} className="px-2 text-xs text-slate-400">…</span>
          ) : (
            <button
              key={i}
              onClick={() => onJump(p as number)}
              disabled={loading}
              className={`min-w-[2rem] rounded-lg px-2.5 py-1 text-xs font-medium ${
                p === page ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {p}
            </button>
          ),
        )}
        <Btn disabled={!can(page + 1)} onClick={() => onJump(page + 1)}>Next ›</Btn>
        <Btn disabled={!can(totalPages)} onClick={() => onJump(totalPages)}>Last »</Btn>
      </div>
    </div>
  );
}

function Btn({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Compact pager: 1 … (n-1) n (n+1) … last */
export function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, total, current, current - 1, current + 1, current - 2, current + 2]);
  const sorted = [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}
