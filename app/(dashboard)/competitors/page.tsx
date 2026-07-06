"use client";

import { useState } from "react";
import { PageHeader, Card, Stat } from "@/app/components/ui";
import { Tabs, useActiveTab } from "@/app/components/Tabs";

// Audit H15 (Session 6): tab id is the URL-stable identifier; the label
// is what renders. The page body switches on the id so reload-/share-safe.
const TABS = [
  { id: "research", label: "Research" },
  { id: "serp-overlap", label: "SERP Overlap" },
  { id: "domain-compare", label: "Domain Compare" },
  { id: "freshness", label: "Freshness" },
] as const;

export default function CompetitorsPage() {
  const [tab] = useActiveTab(TABS, "tab");
  return (
    <div>
      <PageHeader
        title="Competitor Research"
        subtitle="Who else ranks, how often, how recently — and what Edstellar can do differently."
      />
      <div className="space-y-5 p-8">
        <Tabs tabs={TABS} param="tab" />
        {tab === "research" && <ResearchTab />}
        {tab === "serp-overlap" && <SerpOverlapTab />}
        {tab === "domain-compare" && <DomainCompareTab />}
        {tab === "freshness" && <FreshnessTab />}
      </div>
    </div>
  );
}

function ResearchTab() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true); setError(null); setResults([]);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Research failed");
      setResults(data.results ?? []);
    } catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }
  return (
    <>
      <form onSubmit={run} className="flex gap-3">
        <input value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. procurement management training"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-900" />
        <button type="submit" disabled={loading} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Researching…" : "Research"}
        </button>
      </form>
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">{error}</Card>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {results.map((r) => (
          <Card key={r.url}>
            <div className="flex items-center justify-between gap-2">
              <a href={r.url} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-slate-900 hover:underline">
                {r.title || r.domain}
              </a>
              {r.isKnownCompetitor && <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">known competitor</span>}
            </div>
            <div className="truncate text-xs text-slate-400">{r.domain}</div>
            <p className="mt-3 text-sm text-slate-700">{r.summary}</p>
            {r.angle && (
              <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
                <span className="font-medium text-slate-900">Differentiate: </span>{r.angle}
              </p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

function SerpOverlapTab() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault(); if (!topic.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch("/api/competitors/serp-overlap", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }
  return (
    <>
      <form onSubmit={run} className="flex gap-3">
        <input value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="topic / keyword to check the SERP for"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-900" />
        <button disabled={loading} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Checking…" : "Check SERP"}
        </button>
      </form>
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">{error}</Card>}
      {data && (
        <Card>
          <div className="mb-3 text-sm">
            {data.edstellarRank
              ? <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">Edstellar ranks #{data.edstellarRank} for "{data.topic}"</span>
              : <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Edstellar is NOT in the top 10 for "{data.topic}"</span>}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Domain</th>
              <th className="py-2 font-medium">Title</th>
            </tr></thead>
            <tbody>
              {data.organic.map((r: any) => (
                <tr key={r.rank} className={`border-b border-slate-100 ${r.isEdstellar ? "bg-emerald-50" : ""}`}>
                  <td className="py-2 pr-3 tabular-nums">{r.rank}</td>
                  <td className="py-2 pr-3">
                    <span className="text-slate-700">{r.domain}</span>
                    {r.isKnown && <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">known</span>}
                    {r.isEdstellar && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">you</span>}
                  </td>
                  <td className="max-w-md truncate py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-slate-600 hover:underline">{r.title}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function DomainCompareTab() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    const topics = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
    if (!topics.length) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch("/api/competitors/domain-compare", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topics }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }
  return (
    <>
      <Card>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder={"One topic per line (max 8)\nleadership training\ncybersecurity training\n..."}
          className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs outline-none focus:border-slate-900" />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">{text.split("\n").filter((l) => l.trim()).length} topics</span>
          <button onClick={run} disabled={loading} className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {loading ? "Comparing…" : "Compare domains"}
          </button>
        </div>
      </Card>
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">{error}</Card>}
      {data && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Top-10 appearances across {data.topics.length} topics</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2 pr-3 font-medium">Domain</th>
              <th className="py-2 pr-3 font-medium">Appearances</th>
              <th className="py-2 font-medium">Best rank</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.domain} className={`border-b border-slate-100 ${r.domain.includes("edstellar") ? "bg-emerald-50" : ""}`}>
                  <td className="py-2 pr-3">{r.domain}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.appearances}</td>
                  <td className="py-2 tabular-nums">#{r.topRank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function FreshnessTab() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault(); if (!domain.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch("/api/competitors/freshness", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }
  return (
    <>
      <form onSubmit={run} className="flex gap-3">
        <input value={domain} onChange={(e) => setDomain(e.target.value)}
          placeholder="e.g. skillsoft.com  (we'll fetch its sitemap)"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-900" />
        <button disabled={loading} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Fetching…" : "Audit freshness"}
        </button>
      </form>
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">{error}</Card>}
      {data && (
        <Card>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat size="sm" label="URLs" value={data.totalUrls.toLocaleString()} />
            <Stat size="sm" label="Updated last 90d" value={data.recent90d.toLocaleString()} />
            <Stat size="sm" label="Newest lastmod" value={data.newest ?? "—"} />
            <Stat size="sm" label="Oldest lastmod" value={data.oldest ?? "—"} />
          </div>
          <h4 className="mb-2 mt-5 text-xs uppercase tracking-wider text-slate-400">Sample URLs</h4>
          <ul className="space-y-1 text-xs">
            {data.sample.map((s: any) => (
              <li key={s.url} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
                <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-slate-700 hover:underline">{s.url}</a>
                <span className="shrink-0 text-slate-400">{s.lastmod}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// Stat moved to @/app/components/ui — was a tiny inline metric box here;
// the unified component renders this same shape with size="sm".
