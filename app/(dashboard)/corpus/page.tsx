"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, TYPE_COLORS } from "@/app/components/ui";
import { Pagination as SharedPagination } from "@/app/components/Pagination";
import { sameUrl } from "@/lib/url";

interface PageRow {
  id: number;
  url: string;
  title: string | null;
  content_type: string | null;
  course_type: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[] | null;
  lastmod: string | null;
  embedded: boolean;
  // Batch D SEO columns
  owner_url: string | null;
  gsc_clicks_28d: number | null;
  gsc_impressions_28d: number | null;
  gsc_position_28d: number | null;
  canonical_url: string | null;
  image_count: number | null;
  images_no_alt: number | null;
  is_stale: boolean | null;
  stale_reason: string | null;
}

interface ByType { content_type: string; n: number }
interface ByCourseType { course_type: string; n: number }
interface CatCount { category: string; n: number }

// Type colors moved to app/components/ui.tsx and imported above.

const COURSE_TYPES = ["Behavioral", "Compliance", "IT & Technical", "Leadership", "Management", "Social Impact"];

const PAGE_SIZES = [50, 100, 200, 500];

export default function CorpusPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [courseType, setCourseType] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState<PageRow[]>([]);
  const [byType, setByType] = useState<ByType[]>([]);
  const [byCourseType, setByCourseType] = useState<ByCourseType[]>([]);
  const [topCategories, setTopCategories] = useState<CatCount[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalPages, setTotalPages] = useState(1);

  async function load(targetPage = page) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        q, type, courseType, category, tag, limit: String(pageSize), page: String(targetPage),
      });
      const res = await fetch(`/api/pages?${qs}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setByType(data.byType ?? []);
      setByCourseType(data.byCourseType ?? []);
      setTopCategories(data.topCategories ?? []);
      setPage(data.page ?? targetPage);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  }

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, courseType, category, tag, pageSize]);

  const totalAll = byType.reduce((s, x) => s + x.n, 0);

  return (
    <div>
      <PageHeader
        title="Corpus"
        subtitle="The existing-content index every check is compared against — categorised from the Edstellar catalog."
        right={
          <span className="text-sm text-slate-500">
            {total.toLocaleString()} / {totalAll.toLocaleString()} pages
          </span>
        }
      />
      <div className="space-y-5 p-8">
        {/* Breakdown by content_type */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <BreakdownCard label="all" n={totalAll} active={type === ""} onClick={() => { setType(""); setCourseType(""); setCategory(""); setTag(""); }} />
          {byType.map((b) => (
            <BreakdownCard
              key={b.content_type}
              label={b.content_type.replace("-", " ")}
              n={b.n}
              active={type === b.content_type}
              onClick={() => { setType(type === b.content_type ? "" : b.content_type); setCourseType(""); setCategory(""); setTag(""); }}
              colorClass={TYPE_COLORS[b.content_type]}
            />
          ))}
        </div>

        {/* The 6 course types — visible always, highlights when filtering courses */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Course types (the 6)</div>
            {courseType && (
              <button onClick={() => setCourseType("")} className="text-xs text-slate-500 hover:text-slate-700">clear ×</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {COURSE_TYPES.map((ct) => {
              const found = byCourseType.find((b) => b.course_type === ct);
              return (
                <button
                  key={ct}
                  onClick={() => { setType("course"); setCourseType(courseType === ct ? "" : ct); }}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                    courseType === ct
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {ct} <span className={`tabular-nums ${courseType === ct ? "text-indigo-100" : "text-slate-400"}`}>{found?.n ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Top categories — quick filter */}
        {topCategories.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Top categories</div>
              {category && (
                <button onClick={() => setCategory("")} className="text-xs text-slate-500 hover:text-slate-700">clear ×</button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topCategories.slice(0, 20).map((c) => (
                <button
                  key={c.category}
                  onClick={() => setCategory(category === c.category ? "" : c.category)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    category === c.category
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {c.category} <span className={`tabular-nums ${category === c.category ? "text-amber-100" : "text-slate-400"}`}>{c.n}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); setPage(1); load(1); }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or URL…"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-slate-900"
          />
          {tag && (
            <button
              type="button"
              onClick={() => setTag("")}
              className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-slate-700"
            >
              tag: <strong>{tag}</strong> ×
            </button>
          )}
          <button
            type="submit"
            className="rounded-lg bg-slate-700 px-4 py-1.5 text-sm font-medium text-white"
          >
            Search
          </button>
        </form>

        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Clicks 28d</th>
                <th className="px-4 py-3 font-medium">Signals</th>
                <th className="px-4 py-3 font-medium">Modified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-900 hover:underline"
                    >
                      {r.title || r.url}
                    </a>
                    {!r.embedded && (
                      <span className="ml-2 text-xs text-amber-600">not embedded</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.content_type && (
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${TYPE_COLORS[r.content_type] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {r.content_type}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    <div>{r.category || <span className="text-slate-300">—</span>}</div>
                    {r.subcategory && <div className="text-xs text-slate-400">{r.subcategory}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                    {r.gsc_clicks_28d != null ? (
                      <span className={r.gsc_clicks_28d >= 100 ? "font-semibold text-slate-900" : "text-slate-500"}>
                        {r.gsc_clicks_28d.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.owner_url && r.owner_url === r.url && (
                        <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Owner</span>
                      )}
                      {r.is_stale && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800" title={r.stale_reason ?? "Stale"}>Stale</span>
                      )}
                      {r.images_no_alt != null && r.images_no_alt > 0 && (
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700" title={`${r.images_no_alt} of ${r.image_count} images missing alt`}>
                          alt: {r.images_no_alt}
                        </span>
                      )}
                      {r.canonical_url && !sameUrl(r.canonical_url, r.url) && (
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700" title={`canonical → ${r.canonical_url}`}>
                          canonical
                        </span>
                      )}
                      {(r.tags ?? []).slice(0, 2).map((t) => (
                        <button
                          key={t}
                          onClick={() => setTag(t)}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
                          title="Filter by this tag"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{r.lastmod}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No pages match. Try clearing the active filters above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <SharedPagination
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          onJump={(p) => load(p)}
          onPageSize={(n) => setPageSize(n)}
          unit="pages"
        />
      </div>
    </div>
  );
}

function BreakdownCard({
  label, n, active, onClick, colorClass,
}: {
  label: string; n: number; active: boolean; onClick: () => void; colorClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      <div className={`text-xs font-medium capitalize ${active ? "" : colorClass ?? "text-slate-500"} ${active ? "text-white" : ""}`}>
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{n.toLocaleString()}</div>
    </button>
  );
}
