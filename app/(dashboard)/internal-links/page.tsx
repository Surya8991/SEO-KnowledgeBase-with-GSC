"use client";

import { useState } from "react";
import { PageHeader, Card } from "@/app/components/ui";

interface Suggestion {
  rank: number;
  url: string;
  title: string | null;
  contentType: string | null;
  similarity: number;
  anchor: string;
  snippet: string;
}

interface ParaResult {
  index: number;
  preview: string;
  suggestions: { rank: number; url: string; title: string | null; similarity: number; anchor: string; contentType: string | null }[];
}

export default function InternalLinksPage() {
  const [input, setInput] = useState("");
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Paragraph-level mode (#44).
  const [mode, setMode] = useState<"page" | "paragraph">("page");
  const [paraResults, setParaResults] = useState<ParaResult[]>([]);

  async function run() {
    if (!input.trim()) return;
    setLoading(true); setError(null);
    setSummary(null); setSuggestions([]); setParaResults([]);
    try {
      const endpoint = mode === "paragraph" ? "/api/internal-links/paragraph" : "/api/internal-links";
      const body = mode === "paragraph"
        ? { input: input.trim(), perParagraph: Math.max(1, Math.min(6, Math.round(limit / 5))) }
        : { input: input.trim(), limit };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (mode === "paragraph") {
        setParaResults(json.suggestions ?? []);
      } else {
        setSummary(json.summary ?? null);
        setSuggestions(json.suggestions ?? []);
      }
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  function copyHtml() {
    const html = suggestions.map((s) => `<a href="${s.url}">${s.anchor}</a>`).join("\n");
    navigator.clipboard.writeText(html);
  }
  function copyMarkdown() {
    const md = suggestions.map((s) => `[${s.anchor}](${s.url})`).join("\n");
    navigator.clipboard.writeText(md);
  }

  return (
    <div>
      <PageHeader
        title="Internal Links"
        subtitle="For any draft URL or topic, get the top existing pages that should be linked to."
      />
      <div className="space-y-5 p-8">
        <Card>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a draft URL, a topic, or a paragraph of the new content…"
            rows={5}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none focus:border-slate-900"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                onClick={() => setMode("page")}
                className={`rounded px-2 py-1 ${mode === "page" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >Whole page</button>
              <button
                onClick={() => setMode("paragraph")}
                className={`rounded px-2 py-1 ${mode === "paragraph" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >Per paragraph</button>
            </div>
            <label className="text-xs text-slate-600">
              {mode === "page" ? "Suggest" : "Per paragraph approx"}
              <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                {[5,10,15,20,25].map((n) => <option key={n}>{n}</option>)}
              </select>
              links
            </label>
            <div className="grow" />
            <button
              onClick={run}
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Searching…" : "Suggest pages to link to"}
            </button>
          </div>
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
        </Card>

        {summary && (
          <Card className="border-slate-200 bg-slate-50 text-sm text-slate-700">
            <strong className="text-slate-900">Summary:</strong> {summary}
          </Card>
        )}

        {mode === "paragraph" && paraResults.length > 0 && (
          <div className="space-y-3">
            <Card className="bg-slate-50 text-xs text-slate-600">
              <strong>How to use:</strong> each block below is a paragraph from your input
              with its top suggested link targets. Pick the best anchor per paragraph; the
              same target page can appear in multiple paragraphs (the editor decides where
              to use it).
            </Card>
            {paraResults.map((p) => (
              <Card key={p.index} className="p-0">
                <div className="border-b border-slate-200 px-5 py-3">
                  <div className="text-xs uppercase tracking-wider text-slate-400">Paragraph {p.index + 1}</div>
                  <p className="mt-1 text-sm text-slate-700">{p.preview}</p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {p.suggestions.map((s) => (
                    <li key={`${p.index}-${s.url}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <a href={s.url} target="_blank" rel="noreferrer" className="flex-1 truncate font-medium text-slate-900 hover:underline">
                        {s.title || s.url}
                      </a>
                      <span className="text-xs capitalize text-slate-500">{s.contentType}</span>
                      <span className="w-14 text-right text-xs tabular-nums text-slate-500">{(s.similarity * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}

        {mode === "page" && suggestions.length > 0 && (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{suggestions.length} suggested link targets</h3>
              <div className="flex gap-2">
                <button onClick={copyMarkdown} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Copy Markdown</button>
                <button onClick={copyHtml} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Copy HTML</button>
              </div>
            </div>
            <ol className="space-y-3">
              {suggestions.map((s) => (
                <li key={s.url} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                      {s.title || s.url}
                    </a>
                    <span className="text-xs text-slate-500 tabular-nums">{(s.similarity * 100).toFixed(0)}% match</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className="capitalize">{s.contentType}</span>
                    <span>·</span>
                    <span className="truncate">{s.url}</span>
                  </div>
                  {s.snippet && (
                    <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">{s.snippet}</p>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}
