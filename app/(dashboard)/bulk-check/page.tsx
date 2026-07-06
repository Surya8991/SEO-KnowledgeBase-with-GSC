"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/app/components/ui";
import { Pagination } from "@/app/components/Pagination";

interface Result {
  input: string;
  ok: boolean;
  topScore?: number;
  verdict?: "block" | "review" | "pass";
  summary?: string;
  topMatchUrl?: string;
  topMatchTitle?: string;
  topMatchType?: string;
  checkId?: number;
  error?: string;
}

const HISTORY_KEY = "bulk-check:history";
const MAX_HISTORY = 5;

interface RunSnapshot {
  ts: number;
  inputs: string;
  results: Result[];
}

function loadHistory(): RunSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(inputs: string, results: Result[]) {
  const next: RunSnapshot = { ts: Date.now(), inputs, results };
  const prev = loadHistory().slice(0, MAX_HISTORY - 1);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([next, ...prev]));
  } catch {
    // quota exceeded — skip silently
  }
}

export default function BulkCheckPage() {
  const [text, setText] = useState("");
  const [concurrency, setConcurrency] = useState(3);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<string>("");
  const [scoreMin, setScoreMin] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [history, setHistory] = useState<RunSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load saved history on mount.
  useEffect(() => { setHistory(loadHistory()); }, []);

  // Reset to page 1 whenever filters or new results change.
  useEffect(() => { setPage(1) }, [verdictFilter, scoreMin, results.length]);

  function inputsFromText(s: string): string[] {
    return s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  }

  // Live progress — bumped by the worker pool as each row finishes.
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  async function run() {
    const inputs = inputsFromText(text);
    if (!inputs.length) { setError("Paste at least one URL or topic per line."); return }
    if (inputs.length > 100) { setError("Max 100 inputs per run."); return }
    setError(null);
    setLoading(true);
    setResults([]);
    setDoneCount(0);
    setTotalCount(inputs.length);

    // Client-side worker pool — one POST /api/check per input, so the user
    // gets live per-row feedback instead of staring at "Running…" for 4 min.
    // Results land in the table as soon as each finishes.
    let cursor = 0;
    const live: Result[] = new Array(inputs.length);

    async function worker() {
      while (cursor < inputs.length) {
        const idx = cursor++;
        const input = inputs[idx]!;
        try {
          const res = await fetch("/api/check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input, vectorLimit: 30, classifyLimit: 5 }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "check failed");
          live[idx] = {
            input,
            ok: true,
            topScore: data.topScore,
            verdict: data.verdict,
            summary: data.summary,
            topMatchUrl: data.matches?.[0]?.url ?? "",
            topMatchTitle: data.matches?.[0]?.title ?? "",
            topMatchType: data.matches?.[0]?.conflictType ?? "",
            checkId: data.checkId,
          };
        } catch (e) {
          live[idx] = { input, ok: false, error: (e as Error).message };
        }
        // Snapshot the array on each step so React renders the new row.
        setResults([...live].filter(Boolean) as Result[]);
        setDoneCount((n) => n + 1);
      }
    }
    try {
      await Promise.all(Array.from({ length: concurrency }, worker));
      // Persist this run so the user can navigate away and come back.
      const finished = [...live].filter(Boolean) as Result[];
      saveHistory(text, finished);
      setHistory(loadHistory());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadCsv(file: File) {
    const buf = await file.text();
    // accept either plain newline list or simple 1-column CSV
    const lines = buf.split(/\r?\n/).map((l) => l.replace(/^"|"$/g, "").trim()).filter(Boolean);
    setText(lines.join("\n"));
  }

  function downloadCsv() {
    const headers = ["input","verdict","topScore","topMatchTitle","topMatchUrl","topMatchType","summary","error"];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of results) {
      lines.push([r.input, r.verdict ?? "", r.topScore ?? "", r.topMatchTitle ?? "", r.topMatchUrl ?? "", r.topMatchType ?? "", r.summary ?? "", r.error ?? ""].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bulk-check-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const counts = results.reduce(
    (a, r) => ({ ...a, [r.verdict ?? (r.ok ? "pass" : "error")]: (a[r.verdict ?? (r.ok ? "pass" : "error")] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const filteredResults = results
    .filter((r) => !verdictFilter || (r.verdict ?? (r.ok ? "pass" : "error")) === verdictFilter)
    .filter((r) => (r.topScore ?? 0) >= scoreMin);
  const sliced = filteredResults.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="Bulk Conflict Check"
        subtitle="Paste up to a few hundred URLs or topics — get a verdict + score for each, downloadable as CSV."
      />
      <div className="space-y-5 p-8">
        <Card>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"One URL or topic per line\nhttps://www.edstellar.com/blog/...\nleadership training for managers"}
            rows={10}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs outline-none focus:border-slate-900"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-600">Concurrency
              <select
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                {[1,2,3,4,5,6].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600 cursor-pointer rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
              Upload CSV / TXT
              <input type="file" accept=".csv,.txt" hidden
                onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
            </label>
            <span className="text-xs text-slate-400">
              {inputsFromText(text).length} input{inputsFromText(text).length !== 1 ? "s" : ""}
            </span>
            <div className="grow" />
            <button
              onClick={run}
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading
                ? `Running… ${doneCount}/${totalCount}`
                : "Run all checks"}
            </button>
          </div>
          {loading && totalCount > 0 && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-slate-900 transition-all"
                style={{ width: `${(doneCount / totalCount) * 100}%` }}
              />
            </div>
          )}
          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        </Card>

        {history.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              {showHistory ? "Hide" : "Show"} recent runs ({history.length})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1">
                {history.map((h) => (
                  <button
                    key={h.ts}
                    onClick={() => {
                      setText(h.inputs);
                      setResults(h.results);
                      setShowHistory(false);
                    }}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <span className="font-medium">{new Date(h.ts).toLocaleString()}</span>
                    <span className="ml-2 text-slate-400">
                      {h.results.length} results · {h.inputs.split("\n").filter((l) => l.trim()).length} inputs
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {results.length > 0 && (
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="text-sm text-slate-700">
                <strong>{results.length}</strong> done
                {["block","review","pass","error"].map((v) =>
                  counts[v] ? (
                    <button
                      key={v}
                      onClick={() => setVerdictFilter(verdictFilter === v ? "" : v)}
                      className={`ml-2 rounded px-2 py-0.5 text-xs ${
                        verdictFilter === v ? "ring-2 ring-slate-900 ring-offset-1" : ""
                      } ${
                        v === "block" ? "bg-red-100 text-red-700"
                        : v === "review" ? "bg-amber-100 text-amber-700"
                        : v === "pass" ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {counts[v]} {v}
                    </button>
                  ) : null,
                )}
              </div>
              <div className="grow" />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Min score
                <input
                  type="range" min={0} max={100} value={scoreMin}
                  onChange={(e) => setScoreMin(Number(e.target.value))}
                  aria-label="Minimum conflict score"
                  aria-valuetext={`${scoreMin} percent`}
                  className="w-24"
                />
                <input
                  type="number" min={0} max={100} value={scoreMin}
                  onChange={(e) => setScoreMin(Math.min(100, Math.max(0, Number(e.target.value))))}
                  aria-label="Minimum conflict score (number)"
                  className="w-14 rounded border border-slate-300 bg-white px-2 py-0.5 text-center tabular-nums text-slate-700"
                />
                <span>%</span>
              </label>
              <button
                onClick={downloadCsv}
                disabled={loading || results.length === 0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Wait for run to finish…" : "Download CSV"}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-3 font-medium">Input</th>
                    <th className="py-2 pr-3 font-medium">Verdict</th>
                    <th className="py-2 pr-3 font-medium">Score</th>
                    <th className="py-2 pr-3 font-medium">Top match</th>
                    <th className="py-2 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {sliced.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 align-top">
                      <td className="max-w-xs truncate py-2 pr-3 font-mono text-xs">{r.input}</td>
                      <td className="py-2 pr-3">
                        <VerdictPill verdict={r.verdict} ok={r.ok} />
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{r.topScore ?? "—"}</td>
                      <td className="max-w-md truncate py-2 pr-3">
                        {r.topMatchUrl ? (
                          <a href={r.topMatchUrl} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                            {r.topMatchTitle || r.topMatchUrl}
                          </a>
                        ) : r.error ? <span className="text-red-500 text-xs">{r.error}</span> : "—"}
                      </td>
                      <td className="py-2 capitalize text-slate-600">{r.topMatchType || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <Pagination page={page} pageSize={pageSize} total={filteredResults.length} onJump={setPage} onPageSize={setPageSize} unit="results" />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function VerdictPill({ verdict, ok }: { verdict?: string; ok?: boolean }) {
  if (!ok) return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">error</span>;
  const map: Record<string, string> = {
    block:  "bg-red-100 text-red-700",
    review: "bg-amber-100 text-amber-700",
    pass:   "bg-emerald-100 text-emerald-700",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${map[verdict ?? "pass"]}`}>{verdict ?? "pass"}</span>;
}
