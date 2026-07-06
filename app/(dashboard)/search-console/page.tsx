"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { PageHeader, Card } from "@/app/components/ui";
import { countryName } from "@/lib/country";

const RANGES = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "28d", label: "28 days" },
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "12m", label: "12 months" },
  { key: "custom", label: "Custom…" },
] as const;

/** Default the custom-date picker to the last 30 days when first opened. */
function defaultCustomRange(): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { startDate: fmt(start), endDate: fmt(end) };
}

const TABS = [
  "Overview",
  "Cannibalization",
  "Striking Distance",
  "CTR Opportunity",
  "Movers",
  "Untapped",
  "Catalog Gap",
  "Stale Pages",
  "Index Coverage",
] as const;
type Tab = (typeof TABS)[number];

interface Insights {
  range: string;
  startDate: string;
  endDate: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries: any[];
  topPages: any[];
  trend: any[];
  cannibalization: any[];
  striking: any[];
  movers: { winners: any[]; losers: any[] };
  untapped: any[];
  gap: any[];
  byCountry: any[];
  byDevice: any[];
  branded: {
    branded: { clicks: number; impressions: number; ctr: number };
    nonBranded: { clicks: number; impressions: number; ctr: number };
    brandTerms: string[];
  };
  stale: any[];
}

export default function SearchConsolePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <SearchConsoleInner />
    </Suspense>
  );
}

function SearchConsoleInner() {
  const params = useSearchParams();
  const connected = params.get("gsc") === "connected";
  const gscError = params.get("gsc") === "error";

  const [range, setRange] = useState("28d");
  const [customDates, setCustomDates] = useState<{ startDate: string; endDate: string }>(
    defaultCustomRange(),
  );
  const [tab, setTab] = useState<Tab>("Overview");
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Validate the custom-date inputs before letting `load()` fire. */
  const customError: string | null = useMemo(() => {
    if (range !== "custom") return null;
    const { startDate, endDate } = customDates;
    if (!startDate || !endDate) return "Pick a start and end date.";
    if (startDate > endDate) return "Start date must be on or before end date.";
    const todayStr = new Date().toISOString().slice(0, 10);
    if (endDate > todayStr) return "End date can't be in the future.";
    return null;
  }, [range, customDates]);

  // Inline lookup panel (URL or query)
  const [lookupInput, setLookupInput] = useState("");
  const [lookupKind, setLookupKind] = useState<"auto" | "url" | "query">("auto");
  const [lookupData, setLookupData] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  async function runLookup(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = lookupInput.trim();
    if (!trimmed) return;
    // Client-side hint: URL kind without a scheme is the #1 source of API 400s.
    if (lookupKind === "url" && !/^https?:\/\//i.test(trimmed)) {
      setLookupError("URL must start with http:// or https://");
      return;
    }
    setLookupLoading(true); setLookupError(null); setLookupData(null);
    try {
      const res = await fetch("/api/gsc/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: lookupInput.trim(), kind: lookupKind }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setLookupData(json);
    } catch (e) { setLookupError((e as Error).message) }
    finally { setLookupLoading(false) }
  }

  async function load() {
    // For custom ranges, only fire when the date pair is valid.
    if (range === "custom" && customError) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { range };
      if (range === "custom") {
        body.startDate = customDates.startDate;
        body.endDate = customDates.endDate;
      }
      const res = await fetch("/api/gsc/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, customDates.startDate, customDates.endDate]);

  return (
    <div>
      <PageHeader
        title="Search Console"
        subtitle="GSC performance, cannibalization, striking-distance, movers, untapped queries & catalog gap."
        right={
          <a
            href="/api/gsc/auth"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Connect Google
          </a>
        }
      />
      <div className="space-y-6 p-8">
        {connected && (
          <Card className="border-green-200 bg-green-50 text-sm text-green-700">
            Connected to Google Search Console.
          </Card>
        )}
        {gscError && (
          <Card className="border-red-200 bg-red-50 text-sm text-red-700">
            Google connection failed. Check your OAuth credentials and redirect URI.
          </Card>
        )}

        {/* Inline GSC lookup — search any URL or query */}
        <Card>
          <form onSubmit={runLookup} className="flex flex-wrap gap-2">
            <input
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="Lookup any URL or query — e.g. https://www.edstellar.com/blog/...  or  'leadership training'"
              className="flex-1 min-w-[300px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
            <select
              value={lookupKind}
              onChange={(e) => setLookupKind(e.target.value as any)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
            >
              <option value="auto">auto-detect</option>
              <option value="url">as URL</option>
              <option value="query">as query</option>
            </select>
            <button disabled={lookupLoading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {lookupLoading ? "Looking up…" : "Lookup"}
            </button>
          </form>
          {lookupError && <div className="mt-3 text-sm text-red-600">{lookupError}</div>}
          {lookupData && <LookupPanel data={lookupData} />}
        </Card>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  range === r.key
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {r.label}
              </button>
            ))}
            {data && range !== "custom" && (
              <span className="ml-2 text-xs text-slate-400">
                {data.startDate} → {data.endDate}
              </span>
            )}
          </div>

          {/* Custom date inputs — only when "Custom…" is the active range. */}
          {range === "custom" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="text-xs text-slate-600">
                From
                <input
                  type="date"
                  value={customDates.startDate}
                  max={customDates.endDate || undefined}
                  onChange={(e) =>
                    setCustomDates((d) => ({ ...d, startDate: e.target.value }))
                  }
                  className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                />
              </label>
              <label className="text-xs text-slate-600">
                To
                <input
                  type="date"
                  value={customDates.endDate}
                  min={customDates.startDate || undefined}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) =>
                    setCustomDates((d) => ({ ...d, endDate: e.target.value }))
                  }
                  className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                />
              </label>
              <span className="text-xs text-slate-400">
                {customError ? (
                  <span className="text-amber-700">{customError}</span>
                ) : (
                  <>
                    GSC keeps ~16 months of history; rows in the last ~2 days may
                    still be filling in.
                  </>
                )}
              </span>
              {data && !customError && (
                <span className="ml-auto text-xs text-slate-400">
                  {data.startDate} → {data.endDate}
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">
            {error}
            {error.toLowerCase().includes("connect") && (
              <>
                {" "}
                Click <strong>Connect Google</strong> above to authorize.
              </>
            )}
          </Card>
        )}

        {/* KPI row */}
        {data && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Clicks" value={fmt(data.totals.clicks)} />
            <Kpi label="Impressions" value={fmt(data.totals.impressions)} />
            <Kpi label="CTR" value={`${(data.totals.ctr * 100).toFixed(1)}%`} />
            <Kpi label="Avg position" value={data.totals.position.toFixed(1)} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                tab === t
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-sm text-slate-400">Loading…</div>
        )}

        {data && tab === "Overview" && <OverviewTab data={data} range={range} />}
        {data && tab === "Cannibalization" && <CannibalTab data={data} />}
        {data && tab === "Striking Distance" && <StrikingTab data={data} />}
        {data && tab === "CTR Opportunity" && <CtrOppTab data={data} />}
        {data && tab === "Movers" && <MoversTab data={data} />}
        {data && tab === "Untapped" && <UntappedTab data={data} />}
        {data && tab === "Catalog Gap" && <GapTab data={data} />}
        {data && tab === "Stale Pages" && <StaleTab data={data} range={range} />}
        {tab === "Index Coverage" && <IndexCoverageTab />}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
    </Card>
  );
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      Export CSV
    </button>
  );
}

// ---- Tabs ---------------------------------------------------------------

function OverviewTab({ data, range }: { data: Insights; range: string }) {
  const [pageDetail, setPageDetail] = useState<any>(null);
  const [pdLoading, setPdLoading] = useState(false);
  async function drilldown(page: string) {
    setPdLoading(true); setPageDetail({ page });
    const res = await fetch("/api/gsc/page-detail", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ page, range }),
    });
    const json = await res.json();
    setPageDetail(json);
    setPdLoading(false);
  }
  const totalQueryClicks = data.branded.branded.clicks + data.branded.nonBranded.clicks;
  const brandPct = totalQueryClicks ? (data.branded.branded.clicks / totalQueryClicks) * 100 : 0;
  return (
    <>
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Branded vs non-branded</h3>
        <p className="mb-2 text-xs text-slate-500">
          Brand terms: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{data.branded.brandTerms.join(", ") || "—"}</code>
        </p>
        <div className="flex h-6 w-full overflow-hidden rounded-lg bg-slate-100">
          <div className="bg-slate-900" style={{ width: `${brandPct}%` }} title={`Branded ${brandPct.toFixed(1)}%`} />
          <div className="bg-emerald-500 grow" title={`Non-branded ${(100 - brandPct).toFixed(1)}%`} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-4 text-xs text-slate-600">
          <div><span className="inline-block h-2 w-2 rounded-full bg-slate-900" /> <strong>Branded:</strong> {fmt(data.branded.branded.clicks)} clicks · {fmt(data.branded.branded.impressions)} impr · CTR {(data.branded.branded.ctr*100).toFixed(1)}%</div>
          <div><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> <strong>Non-branded:</strong> {fmt(data.branded.nonBranded.clicks)} clicks · {fmt(data.branded.nonBranded.impressions)} impr · CTR {(data.branded.nonBranded.ctr*100).toFixed(1)}%</div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Clicks &amp; impressions over time
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {/* GSC returns date rows ascending (oldest first), which is the
                left-to-right order Recharts wants. The prior `.reverse()` was
                flipping it so the chart read right-to-left (newest left). */}
            <LineChart data={data.trend.map((d: any) => ({ date: d.keys?.[0], ...d }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="clicks" stroke="#0f172a" dot={false} />
              <Line type="monotone" dataKey="impressions" stroke="#94a3b8" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Top queries</h3>
            <ExportBtn
              onClick={() =>
                downloadCsv("top-queries.csv",
                  ["query","clicks","impressions","ctr","position"],
                  data.topQueries.map((r: any) => [r.keys?.[0] ?? "", r.clicks, r.impressions, (r.ctr*100).toFixed(2)+"%", r.position.toFixed(1)]))
              }
            />
          </div>
          <SimpleTable
            cols={["Query","Clicks","Impr","CTR","Pos"]}
            rows={data.topQueries.slice(0, 25).map((r: any) => [
              r.keys?.[0] ?? "",
              fmt(r.clicks),
              fmt(r.impressions),
              (r.ctr * 100).toFixed(1) + "%",
              r.position.toFixed(1),
            ])}
          />
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Top pages <span className="text-xs font-normal text-slate-400">(click for drilldown)</span></h3>
            <ExportBtn
              onClick={() =>
                downloadCsv("top-pages.csv",
                  ["page","clicks","impressions","ctr","position"],
                  data.topPages.map((r: any) => [r.keys?.[0] ?? "", r.clicks, r.impressions, (r.ctr*100).toFixed(2)+"%", r.position.toFixed(1)]))
              }
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  {["Page","Clicks","Impr","CTR","Pos"].map((c) => <th key={c} className="py-2 pr-4 font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.topPages.slice(0, 25).map((r: any, i: number) => (
                  <tr key={i} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => drilldown(r.keys?.[0] ?? "")}>
                    <td className="max-w-md truncate py-2 pr-4 text-slate-700">{shortenUrl(r.keys?.[0] ?? "")}</td>
                    <td className="py-2 pr-4 tabular-nums">{fmt(r.clicks)}</td>
                    <td className="py-2 pr-4 tabular-nums">{fmt(r.impressions)}</td>
                    <td className="py-2 pr-4 tabular-nums">{(r.ctr * 100).toFixed(1)}%</td>
                    <td className="py-2 tabular-nums">{r.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {pageDetail && <PageDetailModal data={pageDetail} loading={pdLoading} onClose={() => setPageDetail(null)} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">By country</h3>
          <SimpleTable
            cols={["Country","Clicks","Impr","CTR","Pos"]}
            rows={data.byCountry.map((r: any) => [
              countryName(r.keys?.[0]),
              fmt(r.clicks),
              fmt(r.impressions),
              (r.ctr * 100).toFixed(1) + "%",
              r.position.toFixed(1),
            ])}
          />
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">By device</h3>
          <SimpleTable
            cols={["Device","Clicks","Impr","CTR","Pos"]}
            rows={data.byDevice.map((r: any) => [
              (r.keys?.[0] ?? "").toLowerCase(),
              fmt(r.clicks),
              fmt(r.impressions),
              (r.ctr * 100).toFixed(1) + "%",
              r.position.toFixed(1),
            ])}
          />
        </Card>
      </div>
    </>
  );
}

function CannibalTab({ data }: { data: Insights }) {
  if (!data.cannibalization.length)
    return <EmptyState text="No cannibalization detected in this range (each query has at most one ranking page)." />;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Cannibalization</h3>
          <p className="text-xs text-slate-500">
            Queries where 2+ pages of yours are competing for the same spot — the listed pages split impressions and clicks.
          </p>
        </div>
        <ExportBtn
          onClick={() =>
            downloadCsv("cannibalization.csv",
              ["query","page","clicks","impressions","position"],
              data.cannibalization.flatMap((g: any) =>
                g.pages.map((p: any) => [g.query, p.page, p.clicks, p.impressions, p.position.toFixed(1)])))
          }
        />
      </div>
      <div className="space-y-4">
        {data.cannibalization.map((g: any) => (
          <div key={g.query} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-slate-900">{g.query}</div>
              <div className="text-xs text-slate-500 tabular-nums">
                {g.pages.length} pages · {fmt(g.totalImpressions)} impr · {fmt(g.totalClicks)} clicks
              </div>
            </div>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {g.pages.map((p: any) => (
                  <tr key={p.page} className="border-t border-slate-100">
                    <td className="max-w-md truncate py-1.5 pr-3">
                      <a href={p.page} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                        {shortenUrl(p.page)}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-600">{fmt(p.clicks)} clk</td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-600">{fmt(p.impressions)} impr</td>
                    <td className="py-1.5 tabular-nums text-slate-600">pos {p.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StrikingTab({ data }: { data: Insights }) {
  if (!data.striking.length)
    return <EmptyState text="No striking-distance queries (positions 8–20 with meaningful impressions)." />;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Striking distance</h3>
          <p className="text-xs text-slate-500">Queries on page 1–2 (position 8–20). Small content/internal-link improvements can pull these into the top 3.</p>
        </div>
        <ExportBtn
          onClick={() =>
            downloadCsv("striking-distance.csv",
              ["query","position","impressions","clicks","ctr","potential_top3_clicks"],
              data.striking.map((r: any) => [r.query, r.position.toFixed(1), r.impressions, r.clicks, (r.ctr*100).toFixed(2)+"%", r.potentialClicks]))
          }
        />
      </div>
      <SimpleTable
        cols={["Query","Pos","Impr","Clicks","CTR","Potential top-3 clicks"]}
        rows={data.striking.map((r: any) => [
          r.query,
          r.position.toFixed(1),
          fmt(r.impressions),
          fmt(r.clicks),
          (r.ctr * 100).toFixed(1) + "%",
          fmt(r.potentialClicks),
        ])}
      />
    </Card>
  );
}

function CtrOppTab({ data }: { data: Insights }) {
  // CTR opportunity = queries on page 1 (pos 1-10) where the CTR is well
  // below what GSC typically sees at that position. The simple heuristic:
  //   expected CTR at position p ≈ 0.3 / p  (rough industry curve)
  // Underperformance = clicks / impressions < 0.5 * expected_at_pos.
  // Need >= 200 impressions / 28d to avoid noise.
  const rows = (data.topQueries ?? [])
    .filter((r: any) => r.impressions >= 200 && r.position <= 10 && r.position >= 1)
    .map((r: any) => {
      const expected = Math.min(0.35, 0.3 / Math.max(1, r.position));
      const gap = expected - r.ctr;
      const potential = Math.max(0, Math.round(expected * r.impressions) - r.clicks);
      return { ...r, expected, gap, potential };
    })
    .filter((r: any) => r.gap > 0.005 && r.potential >= 5)
    .sort((a: any, b: any) => b.potential - a.potential);

  if (!rows.length)
    return <EmptyState text="No clear CTR opportunities — every page-1 query is performing near its expected CTR." />;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">CTR opportunity</h3>
          <p className="text-xs text-slate-500">Queries already on page 1 with sub-curve click-through. Title / meta rewrites here move the needle without touching rankings.</p>
        </div>
        <ExportBtn
          onClick={() =>
            downloadCsv("ctr-opportunity.csv",
              ["query","position","impressions","clicks","ctr","expected_ctr","missed_clicks"],
              rows.map((r: any) => [
                r.query, r.position.toFixed(1), r.impressions, r.clicks,
                (r.ctr*100).toFixed(2)+"%",
                (r.expected*100).toFixed(2)+"%",
                r.potential,
              ]))
          }
        />
      </div>
      <SimpleTable
        cols={["Query","Pos","Impr","Clicks","CTR","Expected","Missed clicks"]}
        rows={rows.map((r: any) => [
          r.query,
          r.position.toFixed(1),
          fmt(r.impressions),
          fmt(r.clicks),
          (r.ctr * 100).toFixed(1) + "%",
          (r.expected * 100).toFixed(1) + "%",
          fmt(r.potential),
        ])}
      />
    </Card>
  );
}

function MoversTab({ data }: { data: Insights }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-emerald-700">Winners (vs previous period)</h3>
        <SimpleTable
          cols={["Query","Δ Clicks","Pos now","Pos prev"]}
          rows={data.movers.winners.map((r: any) => [
            r.query,
            <span key="d" className="text-emerald-600">+{fmt(r.deltaClicks)}</span>,
            r.positionNow.toFixed(1),
            r.positionPrev.toFixed(1),
          ])}
        />
      </Card>
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-rose-700">Losers (vs previous period)</h3>
        <SimpleTable
          cols={["Query","Δ Clicks","Pos now","Pos prev"]}
          rows={data.movers.losers.map((r: any) => [
            r.query,
            <span key="d" className="text-rose-600">{fmt(r.deltaClicks)}</span>,
            r.positionNow.toFixed(1),
            r.positionPrev.toFixed(1),
          ])}
        />
      </Card>
    </div>
  );
}

function UntappedTab({ data }: { data: Insights }) {
  if (!data.untapped.length)
    return <EmptyState text="No high-impression / low-CTR queries detected." />;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Untapped queries</h3>
          <p className="text-xs text-slate-500">High impressions, CTR below what's expected for that position — usually a meta-title / snippet issue.</p>
        </div>
        <ExportBtn
          onClick={() =>
            downloadCsv("untapped.csv",
              ["query","impressions","clicks","ctr","expected_ctr","position","lost_clicks"],
              data.untapped.map((r: any) => [r.query, r.impressions, r.clicks, (r.ctr*100).toFixed(2)+"%", (r.expectedCtr*100).toFixed(2)+"%", r.position.toFixed(1), r.lostClicks]))
          }
        />
      </div>
      <SimpleTable
        cols={["Query","Impr","CTR","Expected CTR","Pos","Est. lost clicks"]}
        rows={data.untapped.map((r: any) => [
          r.query,
          fmt(r.impressions),
          (r.ctr * 100).toFixed(1) + "%",
          (r.expectedCtr * 100).toFixed(1) + "%",
          r.position.toFixed(1),
          <span key="l" className="text-amber-600">{fmt(r.lostClicks)}</span>,
        ])}
      />
    </Card>
  );
}

function GapTab({ data }: { data: Insights }) {
  if (!data.gap.length)
    return <EmptyState text="Every high-impression query matches an existing course/blog/category." />;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Catalog gap</h3>
          <p className="text-xs text-slate-500">Queries you rank for but have no matching course / blog / category — opportunities to create dedicated content.</p>
        </div>
        <ExportBtn
          onClick={() =>
            downloadCsv("catalog-gap.csv",
              ["query","impressions","clicks","position"],
              data.gap.map((r: any) => [r.query, r.impressions, r.clicks, r.position.toFixed(1)]))
          }
        />
      </div>
      <SimpleTable
        cols={["Query","Impr","Clicks","Pos"]}
        rows={data.gap.map((r: any) => [
          r.query,
          fmt(r.impressions),
          fmt(r.clicks),
          r.position.toFixed(1),
        ])}
      />
    </Card>
  );
}

function SimpleTable({
  cols,
  rows,
  linkColumn,
  linkValues,
}: {
  cols: string[];
  rows: (string | number | React.ReactNode)[][];
  linkColumn?: number;
  linkValues?: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
            {cols.map((c) => (
              <th key={c} className="py-2 pr-4 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {r.map((cell, j) => (
                <td key={j} className="max-w-md truncate py-2 pr-4 tabular-nums">
                  {linkColumn === j && linkValues ? (
                    <a href={linkValues[i]} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                      {cell as any}
                    </a>
                  ) : (
                    cell as any
                  )}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="py-6 text-center text-slate-400">
                No data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="text-sm text-slate-500">{text}</Card>
  );
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname.length > 50 ? url.pathname.slice(0, 50) + "…" : url.pathname;
  } catch {
    return u;
  }
}

function StaleTab({ data, range }: { data: Insights; range: string }) {
  if (!data.stale.length)
    return <EmptyState text="No stale pages detected — none have lost ≥30% clicks vs the previous period." />;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Stale pages</h3>
          <p className="text-xs text-slate-500">Pages whose clicks dropped ≥30% vs the previous {range} window — refresh candidates.</p>
        </div>
        <button
          onClick={() => downloadCsv("stale-pages.csv",
            ["page","recent_clicks","prior_clicks","decline","decline_pct"],
            data.stale.map((r: any) => [r.page, r.recentClicks, r.priorClicks, r.decline, (r.declinePct*100).toFixed(1)+"%"]))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >Export CSV</button>
      </div>
      <SimpleTable
        cols={["Page","Recent","Prior","Δ","Δ %"]}
        rows={data.stale.map((r: any) => [
          shortenUrl(r.page),
          fmt(r.recentClicks),
          fmt(r.priorClicks),
          <span key="d" className="text-rose-600">{fmt(r.decline)}</span>,
          <span key="p" className="text-rose-600">{(r.declinePct * 100).toFixed(1)}%</span>,
        ])}
        linkColumn={0}
        linkValues={data.stale.map((r: any) => r.page)}
      />
    </Card>
  );
}

function IndexCoverageTab() {
  const [sample, setSample] = useState(25);
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch("/api/gsc/index-coverage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sample, contentType: type }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Index Coverage</h3>
          <p className="text-xs text-slate-500">Random sample of your corpus → GSC URL Inspection API. Quota: 600 calls / 24h.</p>
        </div>
        <div className="grow" />
        <label className="text-xs text-slate-600">Sample
          <select value={sample} onChange={(e) => setSample(Number(e.target.value))} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs">
            {[10,25,50,100].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
          <option value="">all types</option>
          <option>course</option><option>blog</option><option>category</option><option>subcategory</option><option>static</option>
        </select>
        <button onClick={run} disabled={loading} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {loading ? "Inspecting…" : "Run inspection"}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {data && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {Object.entries(data.buckets as Record<string, number>).map(([k, v]) => (
              <span key={k} className={`rounded px-2 py-1 ${k === "PASS" ? "bg-emerald-100 text-emerald-700" : k === "FAIL" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                {k}: {v}
              </span>
            ))}
          </div>
          <SimpleTable
            cols={["URL","Verdict","Coverage state","Last crawl"]}
            rows={data.results.map((r: any) => [
              shortenUrl(r.url),
              r.verdict,
              r.coverageState || "—",
              r.lastCrawl ? new Date(r.lastCrawl).toLocaleDateString() : "—",
            ])}
            linkColumn={0}
            linkValues={data.results.map((r: any) => r.url)}
          />
        </>
      )}
    </Card>
  );
}

function LookupPanel({ data }: { data: any }) {
  if (data.kind === "url") {
    const d = data.data;
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="mb-2 text-xs text-slate-500">
          URL · <a href={d.url} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">{d.url}</a>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BucketCard title="Last 6 months" b={d.m6} />
          <BucketCard title="Last 12 months" b={d.m12} />
        </div>
        {d.topQueries.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">Top ranking queries (6m)</div>
            <SimpleTable
              cols={["Query","Clicks","Impr","CTR","Pos"]}
              rows={d.topQueries.map((q: any) => [q.query, fmt(q.clicks), fmt(q.impressions), (q.ctr*100).toFixed(1)+"%", q.position.toFixed(1)])}
            />
          </div>
        )}
      </div>
    );
  }
  const d = data.data;
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-2 text-xs text-slate-500">Query · <span className="font-mono text-slate-700">{d.query}</span></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BucketCard title="Last 6 months" b={d.m6} />
        <BucketCard title="Last 12 months" b={d.m12} />
      </div>
      {d.topPages.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">Top pages ranking for this query (6m)</div>
          <SimpleTable
            cols={["Page","Clicks","Impr","CTR","Pos"]}
            rows={d.topPages.map((p: any) => [shortenUrl(p.url), fmt(p.clicks), fmt(p.impressions), (p.ctr*100).toFixed(1)+"%", p.position.toFixed(1)])}
            linkColumn={0}
            linkValues={d.topPages.map((p: any) => p.url)}
          />
        </div>
      )}
    </div>
  );
}
function BucketCard({ title, b }: { title: string; b: { clicks: number; impressions: number; ctr: number; position: number } }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{title}</div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        <div><div className="text-[10px] uppercase text-slate-400">Clicks</div><div className="text-sm font-semibold tabular-nums">{fmt(b.clicks)}</div></div>
        <div><div className="text-[10px] uppercase text-slate-400">Impr</div><div className="text-sm font-semibold tabular-nums">{fmt(b.impressions)}</div></div>
        <div><div className="text-[10px] uppercase text-slate-400">CTR</div><div className="text-sm font-semibold tabular-nums">{(b.ctr*100).toFixed(1)}%</div></div>
        <div><div className="text-[10px] uppercase text-slate-400">Pos</div><div className="text-sm font-semibold tabular-nums">{b.position.toFixed(1)}</div></div>
      </div>
    </div>
  );
}

function PageDetailModal({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  // Esc closes the modal — keyboard parity with the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">Page drilldown</div>
            <div className="font-mono text-sm text-slate-700">{shortenUrl(data.page)}</div>
            {data.startDate && <div className="text-xs text-slate-400">{data.startDate} → {data.endDate}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">Close</button>
        </div>
        {loading ? <div className="py-8 text-center text-sm text-slate-400">Loading…</div> : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs uppercase tracking-wider text-slate-400">Top queries</h4>
              <SimpleTable
                cols={["Query","Clicks","Impr","Pos"]}
                rows={(data.queries ?? []).slice(0, 20).map((r: any) => [r.keys?.[0] ?? "", fmt(r.clicks), fmt(r.impressions), r.position.toFixed(1)])}
              />
            </div>
            <div>
              <h4 className="mb-2 text-xs uppercase tracking-wider text-slate-400">By country</h4>
              <SimpleTable
                cols={["Country","Clicks","Impr"]}
                rows={(data.countries ?? []).slice(0, 8).map((r: any) => [countryName(r.keys?.[0]), fmt(r.clicks), fmt(r.impressions)])}
              />
              <h4 className="mb-2 mt-4 text-xs uppercase tracking-wider text-slate-400">By device</h4>
              <SimpleTable
                cols={["Device","Clicks","Impr","CTR"]}
                rows={(data.devices ?? []).map((r: any) => [(r.keys?.[0] ?? "").toLowerCase(), fmt(r.clicks), fmt(r.impressions), (r.ctr*100).toFixed(1)+"%"])}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
