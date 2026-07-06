"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, ConflictBadge, ScoreBar, TypeChip, TYPE_COLORS } from "@/app/components/ui";
import { Pagination } from "@/app/components/Pagination";
import { toast } from "@/app/components/Toast";
import { scoreBarColor as bandBarColor, scoreTextColor as bandTextColor, intentStage } from "@/lib/score-bands";

interface Match {
  url: string;
  title: string | null;
  contentType: string | null;
  similarity: number;
  conflictScore: number;
  conflictType: string;
  rationale: string;
  overlap?: string[];
  issue?: string;
  ownerUrl?: string | null;
  gscClicks28d?: number | null;
  gscImpressions28d?: number | null;
}
interface CheckResult {
  inputType: string;
  inputValue: string;
  summary: string;
  keywords: string[];
  primaryQuery?: string;
  topScore: number;
  matches: Match[];
  checkId?: number;
}

interface PageStat {
  url: string;
  m6:  { clicks: number; impressions: number; ctr: number; position: number };
  m12: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  potentialQueries?: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
}
interface EnrichData {
  stats: PageStat[];
  serp: any;
  gap: string[];
  ourRank?: any;
  gscError?: string;
}

/** Derive the primary keyword used for the SERP lookup.
 *  Priority:
 *   1. URL slug (blogs/courses/categories/topics — slug IS the primary keyword)
 *   2. The topic the user typed (for topic inputs)
 *   3. LLM keywords[0] (short head term)
 *   4. LLM primaryQuery (long-tail, last resort)
 */
function pickSerpQuery(result: CheckResult): string {
  if (result.inputType === "url") {
    try {
      const path = new URL(result.inputValue).pathname.toLowerCase().replace(/\/$/, "");
      const m = path.match(/^\/(?:blog|course|category|topic|topics)\/(.+)$/);
      if (m) return m[1].replace(/-/g, " ");
    } catch {/* fall through */}
  } else if (result.inputValue?.trim()) {
    return result.inputValue.trim();
  }
  return result.keywords?.[0] || result.primaryQuery || result.inputValue;
}

export default function ConflictCheckerPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  // After 5 s of a check, flip a hint so the user doesn't think the tab froze.
  // Local embedder cold-start is the usual cause of >5s first responses.
  const [slowHint, setSlowHint] = useState(false);
  useEffect(() => {
    if (!loading) { setSlowHint(false); return; }
    const t = setTimeout(() => setSlowHint(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  // Enrichment is lazy: we kick it off after a check completes.
  const [enrich, setEnrich] = useState<EnrichData | null>(null);
  const [enriching, setEnriching] = useState(false);

  // Filters for the match list.
  const [scoreMin, setScoreMin] = useState(80);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"score" | "similarity">("score");

  // Pagination — needed because runs can return 100+ matches.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hideNeedsReview, setHideNeedsReview] = useState(false);

  // Lazy on-demand explanation cache: { [url]: {score, type, rationale, loading?} }
  const [explained, setExplained] = useState<Record<string, any>>({});

  // Search-depth control — how many corpus candidates the vector search retrieves.
  // Named tiers are shown to non-technical users; the numeric value drives the API.
  const [vectorLimit, setVectorLimit] = useState(100);

  // Live-detect whether the input looks like a URL or a topic phrase so the
  // user knows which mode will run before they click Check.
  const detectedMode = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try { new URL(trimmed); return "url"; } catch { return "topic"; }
  }, [input]);

  // New-content suggestions panel (on-demand).
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);

  // Cannibalization groups for the input URL (GSC-driven). Auto-fetched after
  // a URL check completes; surfaced as a banner above the matches list.
  const [cannibals, setCannibals] = useState<any[]>([]);

  // AI Draft state (Batch 18). Cache-first synchronous resolver — either
  // returns instantly from pregenerated_drafts or 2-8s via Groq fallback.
  // No polling, no queued/running states.
  interface DraftState {
    id: number | null;
    draftMd: string;
    source: "cached" | "groq-adapted" | "groq-fresh";
    similarity: number | null;
    model: string;
    sourceUrl: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
  }
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true); setError(null); setResult(null); setEnrich(null); setSuggestions(null);
    setExplained({}); setPage(1); setCannibals([]);
    setDraft(null); setDraftError(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, vectorLimit, minSimilarity: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Lazy: ask the LLM to explain a single match that the initial run skipped.
  async function explain(url: string, title: string | null, similarity: number) {
    if (!result || explained[url]?.loading) return;
    setExplained((e) => ({ ...e, [url]: { ...(e[url] ?? {}), loading: true } }));
    try {
      const res = await fetch("/api/check/classify-one", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url, title, similarity,
          candidateSummary: `${result.summary}\nKeywords: ${result.keywords.join(", ")}`,
        }),
      });
      const json = await res.json();
      setExplained((e) => ({ ...e, [url]: { ...json, loading: false } }));
    } catch (err) {
      setExplained((e) => ({ ...e, [url]: { error: (err as Error).message, loading: false } }));
    }
  }

  // Auto-enrich once we have matches.
  useEffect(() => {
    if (!result || !result.matches.length) return;
    let cancelled = false;
    (async () => {
      setEnriching(true);
      try {
        const urls = result.matches.slice(0, 8).map((m) => m.url);
        const serpTopic = pickSerpQuery(result);
        const res = await fetch("/api/check/enrich", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            urls,
            topic: serpTopic,
            withSerp: true,
          }),
        });
        const data = await res.json();
        if (!cancelled) setEnrich(data);
      } finally {
        if (!cancelled) setEnriching(false);
      }
    })();
    return () => { cancelled = true };
  }, [result]);

  // Cannibalization fetch — only meaningful for URL inputs (GSC keys by page).
  useEffect(() => {
    if (!result || result.inputType !== "url") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/check/cannibalization", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: result.inputValue, range: "28d" }),
        });
        const data = await res.json();
        if (!cancelled) setCannibals(data.groups ?? []);
      } catch {
        if (!cancelled) setCannibals([]);
      }
    })();
    return () => { cancelled = true };
  }, [result]);

  // Cache-first generator. Sends the input directly (so it works even
  // when checkId persistence fails). Resolves synchronously: instant on
  // cache hit, ~2-8s on Groq fallback. No polling, no queue.
  async function generateDraft(forceFresh = false) {
    if (!result || draftLoading) return;
    setDraftLoading(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: result.inputValue,
          checkId: result.checkId,
          forceFresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft generation failed");
      setDraft({
        id: data.id,
        draftMd: data.draftMd,
        source: data.source,
        similarity: data.similarity,
        model: data.model,
        sourceUrl: data.sourceUrl,
        tokensIn: data.tokensIn,
        tokensOut: data.tokensOut,
      });
      const label =
        data.source === "cached" ? "Cached draft loaded instantly." :
        data.source === "groq-adapted" ? "Groq adapted the nearest cached draft." :
        "Groq generated a fresh draft.";
      toast.success(label);
    } catch (e) {
      const msg = (e as Error).message;
      setDraftError(msg);
      toast.error(`Draft failed: ${msg}`);
    } finally {
      setDraftLoading(false);
    }
  }

  function copyDraft() {
    if (!draft?.draftMd) return;
    navigator.clipboard.writeText(draft.draftMd).then(
      () => toast.success("Draft copied to clipboard as Markdown."),
      () => toast.error("Couldn't copy draft to clipboard."),
    );
  }

  async function fetchSuggestions() {
    if (!result) return;
    setSuggesting(true);
    try {
      const suggestTopic =
        result.primaryQuery ||
        (result.inputType === "topic" ? result.inputValue : null) ||
        result.keywords?.[0] ||
        result.inputValue;
      const res = await fetch("/api/suggestions/new-content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: suggestTopic,
          url: result.inputType === "url" ? result.inputValue : undefined,
        }),
      });
      setSuggestions(await res.json());
    } finally {
      setSuggesting(false);
    }
  }

  // Merge in lazily-fetched explanations.
  const mergedMatches = (result?.matches ?? []).map((m) => {
    const ex = explained[m.url];
    if (!ex || ex.loading || ex.error) return m;
    return {
      ...m,
      conflictScore: ex.conflictScore ?? m.conflictScore,
      conflictType:  ex.conflictType  ?? m.conflictType,
      rationale:     ex.rationale     ?? m.rationale,
      overlap:       ex.overlap       ?? m.overlap,
      issue:         ex.issue         ?? m.issue,
    };
  });

  // Apply filters / sort to the match list.
  const filtered = mergedMatches
    .filter((m) => m.conflictScore >= scoreMin)
    .filter((m) => !typeFilter || m.contentType === typeFilter)
    .filter((m) => !hideNeedsReview || m.conflictType !== "needs-review")
    .slice()
    .sort((a, b) =>
      sortBy === "score" ? b.conflictScore - a.conflictScore : b.similarity - a.similarity,
    );

  // Reset page when filters change.
  useEffect(() => { setPage(1) }, [scoreMin, typeFilter, sortBy, hideNeedsReview]);

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Distinct content types present in current matches (for the chip filter).
  const typesInResult = Array.from(
    new Set(result?.matches.map((m) => m.contentType).filter(Boolean) as string[]),
  );

  // How many got LLM rationale vs still awaiting on-demand analysis.
  const explainedCount = mergedMatches.filter((m) => m.conflictType !== "needs-review").length;
  const reviewCount    = mergedMatches.filter((m) => m.conflictType === "needs-review").length;

  const statByUrl = new Map<string, PageStat>();
  for (const s of enrich?.stats ?? []) statByUrl.set(s.url, s);

  return (
    <div>
      <PageHeader
        title="Conflict Checker"
        subtitle="Paste a URL or a topic. We summarize it, score it (0–100%), and enrich each match with GSC + competitor data."
      />
      <div className="p-8 space-y-6">
        <form onSubmit={run} className="space-y-3">
          <div className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://www.edstellar.com/blog/...  or  a topic like 'procurement management training'"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />
            <button type="submit" disabled={loading}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {loading ? "Checking…" : "Check"}
            </button>
          </div>
          {detectedMode && (
            <div className="flex items-center gap-2 text-xs">
              <span className={`rounded-full px-2.5 py-0.5 font-medium ${detectedMode === "url" ? "bg-indigo-50 text-indigo-700 border border-indigo-200" : "bg-slate-100 text-slate-600"}`}>
                {detectedMode === "url" ? "Detected: URL · will fetch and embed" : "Detected: Topic · will embed directly"}
              </span>
            </div>
          )}
          <div role="status" aria-live="polite" aria-atomic="true" className="text-xs text-slate-500">
            {slowHint && (
              <p className="mt-2">
                Still working — the first check of the day takes ~10s while the AI model warms up. Future checks are instant.
              </p>
            )}
          </div>
          {/* Search-depth control */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <label className="flex items-center gap-2">
              Search depth:
              <select value={vectorLimit} onChange={(e) => setVectorLimit(Number(e.target.value))} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                <option value={25}>Quick (25)</option>
                <option value={100}>Standard (100)</option>
                <option value={500}>Thorough (500)</option>
              </select>
            </label>
            <span className="text-slate-400">
              Higher depth finds more overlaps; use the <strong>Min score</strong> slider below to cut noise.
            </span>
          </div>
        </form>

        {error && <Card className="border-red-200 bg-red-50 text-sm text-red-700">{error}</Card>}

        {result && (
          <>
            <Card>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Summary <span className="ml-1 text-xs font-normal text-slate-400">({result.inputType})</span>
                </h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  Highest conflict
                  <span className="font-semibold text-slate-900">{result.topScore}%</span>
                  {result.checkId && (
                    <button
                      onClick={() => copyShareLink(result.checkId!)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50"
                      title={`Share check #${result.checkId}`}
                    >
                      Copy share link
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-700">{result.summary || "—"}</p>
              {result.primaryQuery && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Primary SEO query</span>
                  <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {result.primaryQuery}
                  </span>
                </div>
              )}
              {result.keywords?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.keywords.map((k) => (
                    <span key={k} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{k}</span>
                  ))}
                </div>
              )}
            </Card>

            {/* Cannibalization banner — fires only when input is a URL
                and GSC shows this URL competing with siblings for a query. */}
            {cannibals.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-amber-600">⚠</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-amber-900">
                      Cannibalization detected · {cannibals.length} query{cannibals.length === 1 ? "" : "s"}
                    </h3>
                    <p className="mt-0.5 text-xs text-amber-800">
                      This URL is competing with other pages on your site for the same Google query.
                      Consider redirecting, merging, or differentiating the weaker ones.
                    </p>
                    <ul className="mt-3 space-y-2.5">
                      {cannibals.slice(0, 5).map((g) => (
                        <li key={g.query} className="rounded-md border border-amber-200 bg-white/70 p-2.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-mono text-xs font-medium text-slate-900">"{g.query}"</span>
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {g.totalImpressions.toLocaleString()} impr · {g.totalClicks} clk · {g.pages.length} pages
                            </span>
                          </div>
                          <ul className="mt-1.5 space-y-0.5">
                            {g.pages.slice(0, 4).map((p: any) => {
                              const isThis = p.page === result.inputValue;
                              return (
                                <li key={p.page} className="flex items-center gap-2 text-[11px]">
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 tabular-nums ${isThis ? "bg-amber-200 text-amber-900 font-semibold" : "bg-slate-100 text-slate-600"}`}>
                                    pos {p.position.toFixed(1)}
                                  </span>
                                  <a href={p.page} target="_blank" rel="noreferrer"
                                    className={`truncate hover:underline ${isThis ? "font-semibold text-amber-900" : "text-slate-700"}`}>
                                    {(() => { try { return new URL(p.page).pathname } catch { return p.page } })()}
                                  </a>
                                  <span className="ml-auto shrink-0 text-slate-500 tabular-nums">
                                    {p.impressions.toLocaleString()} impr
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            )}

            {/* Competitor SERP + AI Overview + GSC rank + keyword gap.
                Sits right under the Summary so the user sees external
                context before drilling into matches. */}
            {enrich && enrich.serp && enrich.serp.organic && (
              <Card>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Competitor SERP for "{enrich.serp.topic}"
                  </h3>
                  {enrich.serp.edstellarRank
                    ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Edstellar #{enrich.serp.edstellarRank} on Google</span>
                    : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Edstellar not in top 10</span>}
                </div>

                {/* Our GSC rank for this exact keyword (from Search Console, not SERP scrape) */}
                {enrich.ourRank && enrich.ourRank.impressions6m > 0 && (
                  <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">Your GSC rank for this keyword:</span>{" "}
                    pos <span className="tabular-nums font-medium">{enrich.ourRank.position6m.toFixed(1)}</span>{" "}
                    · <span className="tabular-nums">{enrich.ourRank.clicks6m}</span> clk
                    · <span className="tabular-nums">{enrich.ourRank.impressions6m.toLocaleString()}</span> impr <span className="text-slate-400">(6m)</span>
                    {enrich.ourRank.topPage?.url && (
                      <>
                        {" "}—{" "}
                        <a href={enrich.ourRank.topPage.url} target="_blank" rel="noreferrer" className="text-slate-600 underline-offset-2 hover:underline">
                          {(() => { try { return new URL(enrich.ourRank.topPage.url).pathname } catch { return enrich.ourRank.topPage.url } })()}
                        </a>
                      </>
                    )}
                  </div>
                )}

                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">Domain</th>
                    <th className="py-2 font-medium">Title</th>
                  </tr></thead>
                  <tbody>
                    {enrich.serp.organic.slice(0, 8).map((r: any) => (
                      <tr key={r.rank} className={`border-b border-slate-100 ${r.isEdstellar ? "bg-emerald-50" : ""}`}>
                        <td className="py-2 pr-3 tabular-nums">{r.rank}</td>
                        <td className="py-2 pr-3 text-slate-700">
                          {r.domain}
                          {r.isKnown && <span className="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[10px] text-indigo-700">known</span>}
                          {r.isEdstellar && <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-700">you</span>}
                        </td>
                        <td className="max-w-md truncate py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-slate-600 hover:underline">{r.title}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* AI Overview citations — Google's AI summary panel */}
                {enrich.serp.aiOverview ? (
                  <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                        <span>✨ AI Overview cites</span>
                        <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold normal-case text-violet-700">Google SGE</span>
                      </div>
                      {enrich.serp.aiOverview.edstellarCited
                        ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Edstellar cited ✓</span>
                        : <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">Edstellar not cited</span>}
                    </div>
                    {enrich.serp.aiOverview.summary && (
                      <p className="mb-2 text-xs leading-relaxed text-violet-900">{enrich.serp.aiOverview.summary.slice(0, 320)}{enrich.serp.aiOverview.summary.length > 320 ? "…" : ""}</p>
                    )}
                    {enrich.serp.aiOverview.citations?.length > 0 && (
                      <ol className="space-y-1 text-xs">
                        {enrich.serp.aiOverview.citations.slice(0, 8).map((c: any, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="shrink-0 tabular-nums text-violet-500">{i + 1}.</span>
                            <a href={c.url} target="_blank" rel="noreferrer"
                              className={`truncate hover:underline ${c.isEdstellar ? "font-semibold text-emerald-700" : "text-slate-700"}`}>
                              {c.domain}
                              {c.isKnown && <span className="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[9px] text-indigo-700">known</span>}
                              {c.isEdstellar && <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] text-emerald-700">you</span>}
                              {" — "}
                              <span className="text-slate-500">{c.title}</span>
                            </a>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    No AI Overview appeared on Google for this query.
                  </div>
                )}

                {enrich.gap?.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Keyword gap (mentioned by competitors, not in your top queries)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {enrich.gap.map((k) => (
                        <span key={k} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Filters — visible when there's anything to filter */}
            {result.matches.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Type:</span>
                <button
                  onClick={() => setTypeFilter("")}
                  className={`rounded px-2 py-1 ${typeFilter === "" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}
                >all</button>
                {typesInResult.map((t) => {
                  const active = typeFilter === t;
                  const colorClass = TYPE_COLORS[t] ?? "bg-slate-100 text-slate-600";
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(active ? "" : t)}
                      className={`rounded px-2 py-1 capitalize ${
                        active
                          ? "bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-1"
                          : `${colorClass} hover:opacity-80`
                      }`}
                    >
                      {t.replace("-", " ")}
                    </button>
                  );
                })}
                <span className="ml-2 text-slate-500">Min score:</span>
                <input
                  type="range" min={0} max={100} value={scoreMin}
                  onChange={(e) => setScoreMin(Number(e.target.value))}
                  aria-label="Minimum conflict score"
                  aria-valuetext={`${scoreMin} percent`}
                  className="w-32"
                />
                <input
                  type="number" min={0} max={100} value={scoreMin}
                  onChange={(e) => setScoreMin(Math.min(100, Math.max(0, Number(e.target.value))))}
                  aria-label="Minimum conflict score (number)"
                  className="w-14 rounded border border-slate-300 bg-white px-2 py-0.5 text-center tabular-nums text-slate-700"
                />
                <span className="text-slate-400">%</span>
                <label className="ml-2 flex items-center gap-1 text-slate-600">
                  <input type="checkbox" checked={hideNeedsReview} onChange={(e) => setHideNeedsReview(e.target.checked)} />
                  hide unanalyzed
                </label>
                <span className="ml-2 text-slate-500">Sort:</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="rounded border border-slate-300 bg-white px-2 py-1">
                  <option value="score">by score</option>
                  <option value="similarity">by similarity</option>
                </select>
                <span className="ml-auto text-slate-400">{filtered.length} of {result.matches.length}</span>
              </div>
            )}

            <div>
              <h2 className="mb-3 flex flex-wrap items-baseline gap-x-3 text-sm font-semibold text-slate-900">
                <span>{filtered.length} pages with conflict ≥ {scoreMin}%</span>
                <span className="text-xs font-normal text-slate-500">
                  · of {result.matches.length} total · {explainedCount} analyzed · {reviewCount} not yet analyzed
                </span>
                {enriching && (
                  <span className="text-xs font-normal text-slate-400">· fetching GSC + competitor data…</span>
                )}
              </h2>
              {filtered.length === 0 ? (
                <Card className="text-sm text-slate-500">
                  No conflicts above {scoreMin}%. Drag the Min score slider lower to see weaker overlaps.
                </Card>
              ) : (
                <>
                  <div className="space-y-3">
                    {paginated.map((m) => (
                      <MatchCard
                        key={m.url}
                        m={m}
                        stat={statByUrl.get(m.url)}
                        explainState={explained[m.url]}
                        onExplain={() => explain(m.url, m.title, m.similarity)}
                      />
                    ))}
                  </div>
                  <div className="mt-4">
                    <Pagination
                      page={page}
                      pageSize={pageSize}
                      total={filtered.length}
                      onJump={setPage}
                      onPageSize={setPageSize}
                      pageSizes={[25, 50, 100, 200]}
                      unit="matches"
                    />
                  </div>
                </>
              )}
            </div>

            {/* New-content suggestions trigger */}
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Net-new content suggestions</h3>
                  <p className="text-xs text-slate-500">LLM proposes angles based on competitors, AI Overview, recent Google updates, and AI platforms.</p>
                </div>
                <div className="flex items-center gap-2">
                  {suggestions?.suggestions?.angles?.length > 0 && (
                    <button
                      onClick={() => copyWriterBrief(result, suggestions.suggestions, suggestions.serp)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      title="Copy a Markdown brief for the writer"
                    >
                      Copy brief
                    </button>
                  )}
                  <button onClick={fetchSuggestions} disabled={suggesting}
                    className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                    {suggesting ? "Thinking…" : suggestions ? "Re-run" : "Suggest"}
                  </button>
                </div>
              </div>
              {suggestions?.suggestions?.headline && (
                <p className="mt-4 text-sm font-medium text-slate-800">{suggestions.suggestions.headline}</p>
              )}
              {suggestions?.suggestions?.angles?.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {suggestions.suggestions.angles.map((a: any, i: number) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-slate-900">{a.title}</div>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] capitalize text-slate-600">{a.format}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">Audience: {a.audience}</div>
                      <div className="text-xs text-slate-500">Keyword: <span className="font-mono">{a.primaryKeyword}</span></div>
                      <p className="mt-2 text-xs text-slate-600">{a.differentiation}</p>
                      {a.trigger && <span className="mt-2 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] capitalize text-indigo-700">{a.trigger.replace("-", " ")}</span>}
                    </div>
                  ))}
                </div>
              )}
              {suggestions && !suggestions?.suggestions?.angles?.length && !suggestions?.error && (
                <p className="mt-3 text-xs text-slate-500">No angles returned — the LLM response wasn't parseable. Try Re-run.</p>
              )}
              {/* PAA — questions Google considers related. Free signal from
                  the SERP, surfaced here so writers can answer them in-page
                  (good for AI Overview citation). (#39) */}
              {(suggestions?.serp?.peopleAlsoAsk?.length ?? 0) > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Questions to address (from People-Also-Ask)
                  </div>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {suggestions.serp.peopleAlsoAsk.slice(0, 6).map((q: any, i: number) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-slate-400">·</span>
                        <span>{q.question}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {suggestions?.error && <div className="mt-3 text-sm text-red-600">{suggestions.error}</div>}
            </Card>

            {/* AI Draft panel — cache-first via pregenerated_drafts; Groq fallback. */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">AI Draft</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Cache-first: looks for the nearest pre-generated draft in the database. If similarity ≥ 85% you get it instantly. Otherwise Groq (llama-3.3-70b-versatile) adapts the nearest match or generates fresh in 2–8s, and the result is cached for next time.
                  </p>
                  <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                    <li>• <strong>Cached</strong> badge = served from the offline-generated library, free + instant.</li>
                    <li>• <strong>Adapted</strong> badge = Groq rewrote the nearest cached draft for this exact topic.</li>
                    <li>• <strong>Fresh</strong> badge = Groq generated from scratch (no near-neighbour in cache).</li>
                    <li>• To grow the cached library, run <code className="rounded bg-slate-100 px-1 text-[10px]">npm run pregen-drafts</code> on your machine (uses Antigravity or Claude Code).</li>
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  {draft && (
                    <button
                      onClick={copyDraft}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Copy draft
                    </button>
                  )}
                  <button
                    onClick={() => generateDraft(false)}
                    disabled={draftLoading}
                    className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {draftLoading ? "Working…" : draft ? "Re-fetch" : "Generate draft"}
                  </button>
                  {draft && (
                    <button
                      onClick={() => generateDraft(true)}
                      disabled={draftLoading}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="Force a fresh Groq generation (skips cache)"
                    >
                      Regenerate
                    </button>
                  )}
                </div>
              </div>

              {draftLoading && !draft && (
                <p className="mt-4 text-xs text-slate-500">Checking cache, then falling back to Groq if needed…</p>
              )}
              {draftError && (
                <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{draftError}</div>
              )}

              {draft && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ${
                      draft.source === "cached"        ? "bg-emerald-100 text-emerald-700" :
                      draft.source === "groq-adapted"  ? "bg-violet-100 text-violet-700"   :
                                                         "bg-blue-100 text-blue-700"
                    }`}>
                      {draft.source === "cached" ? "cached" : draft.source === "groq-adapted" ? "adapted" : "fresh"}
                    </span>
                    {draft.similarity != null && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 tabular-nums">
                        match {(draft.similarity * 100).toFixed(0)}%
                      </span>
                    )}
                    {draft.sourceUrl && (
                      <a
                        href={draft.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-slate-500 hover:underline"
                        title={draft.sourceUrl}
                      >
                        ← from {(() => { try { return new URL(draft.sourceUrl).pathname } catch { return draft.sourceUrl } })()}
                      </a>
                    )}
                    <span className="text-slate-400 tabular-nums">· {draft.model}</span>
                    {draft.tokensOut != null && (
                      <span className="text-slate-400 tabular-nums">
                        · {draft.tokensIn ?? 0} in / {draft.tokensOut} out
                      </span>
                    )}
                  </div>

                  <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-800">
                    {draft.draftMd}
                  </pre>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function KeywordList({
  label,
  badge,
  accent,
  empty,
  rows,
  showClicks,
}: {
  label: string;
  badge?: string;
  accent: "slate" | "emerald";
  empty: string;
  rows: { query: string; clicks: number; impressions: number; position: number }[];
  showClicks?: boolean;
}) {
  const headerColor = accent === "emerald" ? "text-emerald-700" : "text-slate-500";
  const badgeColor =
    accent === "emerald"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-slate-100 text-slate-600";
  return (
    <div>
      <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${headerColor}`}>
        <span>{label}</span>
        {badge && (
          <span className={`rounded px-1 py-0.5 text-[9px] font-bold normal-case ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-400">{empty}</div>
      ) : (
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400">
              <th className="py-1 pr-2 text-left font-medium">Query</th>
              <th className="w-10 py-1 text-right font-medium">Pos</th>
              {showClicks && <th className="w-10 py-1 text-right font-medium">Clk</th>}
              <th className="w-14 py-1 pl-2 text-right font-medium">Impr</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {rows.map((q) => (
              <tr key={q.query} className="border-b border-slate-50 last:border-0">
                <td className="break-words py-1 pr-2 align-top">{q.query}</td>
                <td className="py-1 text-right align-top tabular-nums">{q.position.toFixed(1)}</td>
                {showClicks && <td className="py-1 text-right align-top tabular-nums">{q.clicks}</td>}
                <td className="py-1 pl-2 text-right align-top tabular-nums text-slate-500">
                  {q.impressions.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MatchCard({
  m, stat, explainState, onExplain,
}: {
  m: Match;
  stat?: PageStat;
  explainState?: { loading?: boolean; error?: string; rationale?: string };
  onExplain?: () => void;
}) {
  const needsReview = m.conflictType === "needs-review";
  const [open, setOpen] = useState(false);
  const hasRationale = !!m.rationale;

  // Audit 10C tokenization: lib/score-bands.ts is the single source of truth.
  const scoreBarColor = bandBarColor(m.conflictScore);
  const scoreTextColor = bandTextColor(m.conflictScore);
  const stage = intentStage(m.contentType);

  return (
    <Card className="transition hover:border-slate-300 hover:shadow-sm">
      {/* ── HEADER ─────────────────────────────────────────────────
          Two columns: identity on the left, score on the right.
          Identity stack: chips → title → URL → meta strip. */}
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <TypeChip type={m.contentType} />
            {stage && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                stage === "TOFU" ? "border border-blue-200 bg-blue-50 text-blue-700" :
                stage === "MOFU" ? "border border-violet-200 bg-violet-50 text-violet-700" :
                "border border-emerald-200 bg-emerald-50 text-emerald-700"
              }`} title={
                stage === "TOFU" ? "Top of Funnel — awareness content" :
                stage === "MOFU" ? "Middle of Funnel — consideration content" :
                "Bottom of Funnel — conversion content"
              }>
                {stage}
              </span>
            )}
            {m.ownerUrl && m.ownerUrl === m.url && (
              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                Owner
              </span>
            )}
            {m.ownerUrl && m.ownerUrl !== m.url && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600" title={`Owner: ${m.ownerUrl}`}>
                Non-owner
              </span>
            )}
          </div>
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-base font-semibold text-slate-900 hover:underline"
            title={m.title || m.url}
          >
            {m.title || m.url}
          </a>
          <div className="mt-0.5 truncate text-xs text-slate-400">{m.url}</div>

          {/* Meta strip — similarity + impact + action hint live on one line
              so the card stays compact and the score column has more room. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <span
              className="text-slate-500"
              title="Topic similarity: how closely this page's content matches your input, measured by AI embeddings (0–100%)"
            >
              <span className="font-semibold text-slate-700 tabular-nums">{(m.similarity * 100).toFixed(1)}%</span>
              <span className="ml-1 text-slate-400">topic similarity</span>
            </span>
            {m.gscClicks28d != null && m.gscClicks28d > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-amber-800">
                <strong className="tabular-nums">{m.gscClicks28d.toLocaleString()}</strong>
                <span className="text-amber-700">clicks · 28d</span>
                {m.gscImpressions28d != null && m.gscImpressions28d >= 1000 && (
                  <span className="text-amber-600">· {Math.round(m.gscImpressions28d / 1000)}k impr</span>
                )}
              </span>
            )}
            {m.ownerUrl && m.ownerUrl !== m.url && (
              <a
                href={m.ownerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700 hover:bg-indigo-100"
                title="Redirect this page to its editorial owner"
              >
                → redirect to owner
              </a>
            )}
          </div>
        </div>

        {/* Score column — large numeric for the eye, slim bar for context,
            badge for the editorial verdict. */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${scoreBarColor}`} style={{ width: `${m.conflictScore}%` }} />
            </div>
            <span className={`w-12 text-right text-xl font-bold tabular-nums leading-none ${scoreTextColor}`}>
              {m.conflictScore}%
            </span>
          </div>
          <ConflictBadge type={m.conflictType} />
        </div>
      </div>

      {/* ── GSC ENRICHMENT ─────────────────────────────────────────
          Inline 3-col grid for the stats panel (no heavy boxed table)
          + keyword lists on the right. Both share the same top divider
          rule so they read as one section. */}
      {stat && (
        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              GSC performance
            </div>
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400">
                  <th className="py-1 pr-2 text-left font-medium">Metric</th>
                  <th className="py-1 text-right font-medium">6m</th>
                  <th className="py-1 pl-2 text-right font-medium">12m</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="py-1 pr-2 text-slate-500">Clicks</td>
                  <td className="py-1 text-right font-semibold tabular-nums text-slate-900">{stat.m6.clicks}</td>
                  <td className="py-1 pl-2 text-right font-semibold tabular-nums text-slate-900">{stat.m12.clicks}</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-1 pr-2 text-slate-500">Impressions</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{stat.m6.impressions.toLocaleString()}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-slate-700">{stat.m12.impressions.toLocaleString()}</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-1 pr-2 text-slate-500">CTR</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{(stat.m6.ctr * 100).toFixed(2)}%</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-slate-700">{(stat.m12.ctr * 100).toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-slate-500">Position</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{stat.m6.position.toFixed(1)}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-slate-700">{stat.m12.position.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3.5">
            <KeywordList
              label="Top ranking keywords"
              accent="slate"
              empty="No GSC data for this URL."
              rows={stat.topQueries}
              showClicks
            />
            <KeywordList
              label="Potential ranking keywords"
              badge="pos 11–30"
              accent="emerald"
              empty="No striking-distance opportunities yet."
              rows={stat.potentialQueries ?? []}
            />
          </div>
        </div>
      )}

      {/* ── DETAILS ──────────────────────────────────────────────── */}
      {hasRationale ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="-mx-1 -my-0.5 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            aria-expanded={open}
          >
            <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            {open ? "Hide details" : "Show why this conflicts"}
          </button>
          {open && (
            <div className="mt-3 space-y-3">
              {m.overlap && m.overlap.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Both cover
                  </span>
                  {m.overlap.map((o) => (
                    <span
                      key={o}
                      className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                    >
                      {o}
                    </span>
                  ))}
                </div>
              )}
              {m.issue && (
                <div className="flex items-start gap-2.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 text-sm leading-none text-rose-600">⚠</span>
                  <p className="text-sm leading-snug text-rose-800">{m.issue}</p>
                </div>
              )}
              {m.rationale && (
                <p className="text-sm leading-relaxed text-slate-600">{m.rationale}</p>
              )}
            </div>
          )}
        </div>
      ) : needsReview ? (
        <div className="mt-4 border-t border-slate-100 pt-3 flex items-center gap-3">
          <span className="text-xs text-slate-400">Not yet analyzed</span>
          {explainState?.error ? (
            <div className="text-xs text-red-600">{explainState.error}</div>
          ) : (
            <button
              onClick={onExplain}
              disabled={explainState?.loading}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {explainState?.loading ? "Analyzing…" : "Analyze with AI (~3s)"}
            </button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Produce a Markdown writer brief from the check result + suggestions panel
 * and drop it on the clipboard. Marketers paste this into Notion / Google
 * Docs as the starting outline. (#35)
 */
function copyWriterBrief(result: CheckResult | null, suggestions: any, serp?: any) {
  if (!result) return;
  const angles = (suggestions?.angles ?? []) as Array<any>;
  const lines: string[] = [];
  const topAngle = angles[0];

  lines.push(`# Content brief — ${topAngle?.title ?? result.summary.split(".")[0]}`);
  lines.push("");
  if (suggestions?.headline) {
    lines.push(`> ${suggestions.headline}`);
    lines.push("");
  }

  lines.push(`**Topic / source:** ${result.inputValue}`);
  if (result.primaryQuery) lines.push(`**Primary keyword:** ${result.primaryQuery}`);
  if (topAngle) {
    lines.push(`**Format:** ${topAngle.format}`);
    lines.push(`**Audience:** ${topAngle.audience}`);
    lines.push(`**Differentiation:** ${topAngle.differentiation}`);
  }
  lines.push("");

  lines.push("## Summary of what we'd publish");
  lines.push(result.summary);
  lines.push("");

  if (result.keywords?.length) {
    lines.push("## Keyword set");
    lines.push(result.keywords.map((k) => `- ${k}`).join("\n"));
    lines.push("");
  }

  // PAA from Serper — questions Google considers related. Answering these
  // in the article is the cheapest way to be eligible for AI Overview
  // citations and featured snippets. (#39)
  const paa = (serp?.peopleAlsoAsk ?? []) as { question: string; snippet?: string }[];
  if (paa.length) {
    lines.push("## Questions to address (Google PAA)");
    for (const q of paa.slice(0, 8)) {
      lines.push(`- **${q.question}**`);
      if (q.snippet) lines.push(`  - Hint: ${q.snippet}`);
    }
    lines.push("");
  }
  if (serp?.answerBox?.snippet) {
    lines.push("## Current featured snippet on this topic");
    lines.push(`> ${serp.answerBox.snippet}`);
    if (serp.answerBox.link) lines.push(`Source: ${serp.answerBox.link}`);
    lines.push("");
  }

  if (angles.length > 1) {
    lines.push("## Alternative angles considered");
    for (const a of angles.slice(1)) {
      lines.push(`- **${a.title}** (${a.format}) — ${a.differentiation}`);
    }
    lines.push("");
  }

  const toAvoid = result.matches
    .filter((m) => m.conflictScore >= 60)
    .slice(0, 5);
  if (toAvoid.length) {
    lines.push("## Avoid overlap with these existing pages");
    for (const m of toAvoid) {
      const ownerHint = m.ownerUrl && m.ownerUrl !== m.url ? ` — owner: ${m.ownerUrl}` : "";
      const traffic = m.gscClicks28d ? ` · ${m.gscClicks28d.toLocaleString()} clicks/28d` : "";
      lines.push(`- [${m.title || m.url}](${m.url}) — ${m.conflictType}, score ${m.conflictScore}%${traffic}${ownerHint}`);
      if (m.issue) lines.push(`  - ${m.issue}`);
    }
    lines.push("");
  }

  const linkTargets = result.matches
    .filter((m) => m.conflictScore < 60 && m.conflictScore >= 30)
    .slice(0, 5);
  if (linkTargets.length) {
    lines.push("## Suggested internal-link targets (related, not overlapping)");
    for (const m of linkTargets) {
      lines.push(`- [${m.title || m.url}](${m.url})`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Generated from Conflict Checker · check #${result.checkId ?? "draft"}_`);

  const md = lines.join("\n");
  // Audit H14 (Session 6): swapped the modal `alert()` for a transient
  // toast. Also handle the clipboard rejection — writeText fails on
  // non-HTTPS pages, denied permissions, or browsers that block during
  // background tabs.
  navigator.clipboard.writeText(md).then(
    () => toast.success("Writer brief copied to clipboard as Markdown."),
    (err) =>
      toast.error(
        `Couldn't copy to clipboard: ${(err as Error).message || "unknown error"}`,
      ),
  );
}

function copyShareLink(checkId: number) {
  const url = `${window.location.origin}/check/${checkId}`;
  navigator.clipboard.writeText(url).then(
    () => toast.success(`Share link copied — /check/${checkId}`),
    () => toast.error("Couldn't copy link to clipboard."),
  );
}
