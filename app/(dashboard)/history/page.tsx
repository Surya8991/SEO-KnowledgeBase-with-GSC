"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/app/components/ui";
import { Pagination } from "@/app/components/Pagination";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface SummaryRow {
  input_value: string;
  input_type: string;
  runs: number;
  last_run: string;
  min_score: number;
  max_score: number;
  last_score: number;
}
interface HistRow {
  id: number;
  input_value: string;
  summary: string;
  top_score: number;
  created_at: string;
  outcome?: string | null;
}
interface MatchRow {
  page_url: string;
  page_title: string | null;
  similarity: number;
  conflict_score: number;
  conflict_type: string;
  rationale: string;
  rank: number;
}

// Sidebar list of checks — narrower viewport budget than the data-heavy
// audit / corpus views, so keep choices smaller.
const PAGER_SIZES = [25, 50, 100];

export default function HistoryPage() {
  const [list, setList] = useState<SummaryRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [scoreBand, setScoreBand] = useState<"all" | "block" | "review" | "pass">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => { setPage(1); }, [filter, scoreBand]);

  async function loadList() {
    setLoading(true);
    const res = await fetch("/api/check/history?limit=200");
    const json = await res.json();
    setList(json.rows ?? []);
    setLoading(false);
  }

  async function loadOne(input: string) {
    setSelected(input);
    setHistory([]);
    setMatches([]);
    const res = await fetch(`/api/check/history?input=${encodeURIComponent(input)}`);
    const json = await res.json();
    setHistory(json.history ?? []);
    setMatches(json.matches ?? []);
  }

  useEffect(() => { loadList(); }, []);

  const filteredList = list
    .filter((r) => filter === "" || r.input_value.toLowerCase().includes(filter.toLowerCase()))
    .filter((r) => {
      if (scoreBand === "all") return true;
      if (scoreBand === "block") return r.last_score >= 80;
      if (scoreBand === "review") return r.last_score >= 60 && r.last_score < 80;
      return r.last_score < 60;
    });
  const slice = filteredList.slice((page - 1) * pageSize, page * pageSize);

  const chartData = history.map((h) => {
    return { date: new Date(h.created_at).toLocaleString(), score: h.top_score };
  });

  const emptyMsg =
    list.length === 0
      ? "No checks yet. Run one from /conflict-checker."
      : "No checks match the current filter.";

  return (
    <div>
      <PageHeader
        title="Conflict Score History"
        subtitle="Every check ever run. Re-run any input to track how the score moves post-publish."
      />
      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter checks..."
              className="flex-1 min-w-[160px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900"
            />
            <select
              value={scoreBand}
              onChange={(e) => setScoreBand(e.target.value as "all" | "block" | "review" | "pass")}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              <option value="all">all scores</option>
              <option value="block">block 80+</option>
              <option value="review">review 60-79</option>
              <option value="pass">pass under 60</option>
            </select>
          </div>

          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2 text-xs uppercase text-slate-400">
              Recent checks {loading ? " loading..." : ""}
              <span className="ml-1 normal-case text-slate-400">
                ({filteredList.length})
              </span>
            </div>
            <ul className="max-h-[70vh] overflow-y-auto">
              {slice.map((r) => (
                <li key={r.input_value}>
                  <button
                    onClick={() => loadOne(r.input_value)}
                    className={
                      "flex w-full items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-left text-sm hover:bg-slate-50 " +
                      (selected === r.input_value ? "bg-slate-50" : "")
                    }
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{r.input_value}</div>
                      <div className="text-xs text-slate-500">
                        {r.input_type} - {r.runs} run{r.runs > 1 ? "s" : ""} - last {new Date(r.last_run).toLocaleDateString()}
                      </div>
                    </div>
                    <ScorePill score={r.last_score} />
                  </button>
                </li>
              ))}
              {slice.length === 0 && !loading ? (
                <li className="px-4 py-8 text-center text-sm text-slate-400">{emptyMsg}</li>
              ) : null}
            </ul>
          </Card>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={filteredList.length}
            onJump={setPage}
            onPageSize={setPageSize}
            pageSizes={PAGER_SIZES}
            unit="checks"
          />
        </div>

        <div className="space-y-5 lg:col-span-3">
          {!selected ? (
            <Card className="text-sm text-slate-500">Select a check on the left to see its history.</Card>
          ) : null}

          {selected ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                Score over time -{" "}
                <span className="font-mono text-xs text-slate-500">{selected}</span>
              </h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#0f172a" dot={true} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2">
                    <span>{new Date(h.created_at).toLocaleString()}</span>
                    <div className="flex items-center gap-2">
                      <ScorePill score={h.top_score} />
                      <OutcomeSelect
                        checkId={h.id}
                        value={h.outcome ?? ""}
                        onChange={(v) => setHistory((arr) => arr.map((r) => r.id === h.id ? { ...r, outcome: v } : r))}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {selected && matches.length > 0 ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Latest matches</h3>
              <ul className="space-y-2">
                {matches.map((m) => (
                  <li key={m.rank} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <a
                        href={m.page_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {m.page_title || m.page_url}
                      </a>
                      <ScorePill score={m.conflict_score} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{m.conflict_type}</div>
                    {m.rationale ? (
                      <p className="mt-1 text-xs text-slate-600">{m.rationale}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const n = Math.round(score ?? 0);
  const color =
    n >= 80
      ? "bg-red-100 text-red-700"
      : n >= 60
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  return (
    <span className={"rounded px-2 py-0.5 text-xs font-medium tabular-nums " + color}>
      {n}
    </span>
  );
}

/**
 * Outcome selector — records what the editor actually did with this check
 * (published / merged / redirected / discarded). Powers the shipped-vs-
 * blocked reporting on the dashboard. (#36)
 */
function OutcomeSelect({
  checkId, value, onChange,
}: { checkId: number; value: string; onChange: (v: string | null) => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <select
      value={value}
      disabled={saving}
      onChange={async (e) => {
        const v = e.target.value || null;
        setSaving(true);
        try {
          await fetch("/api/check/outcome", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ checkId, outcome: v }),
          });
          onChange(v);
        } finally { setSaving(false) }
      }}
      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600"
    >
      <option value="">no outcome</option>
      <option value="published">published</option>
      <option value="merged">merged</option>
      <option value="redirected">redirected</option>
      <option value="discarded">discarded</option>
    </select>
  );
}
