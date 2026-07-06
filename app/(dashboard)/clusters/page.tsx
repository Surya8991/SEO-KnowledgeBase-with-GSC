"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PageHeader, Card, TypeChip,
  INTENT_STYLE, ACTION_STYLE, pathOf,
  type Intent, type ClusterAction,
} from "@/app/components/ui";

type EvidenceSignal = "title" | "h1" | "description" | "url" | "body";

interface GroupMember {
  url: string;
  title: string | null;
  type: string | null;
  intent: Intent;
  /** Cosine similarity to this page's strongest match inside the cluster. */
  matchSim: number;
  /** Signals corroborating that strongest edge — the "why grouped" tags. */
  evidence: EvidenceSignal[];
  isWinner: boolean;
}
interface GroupSummary {
  size: number;
  maxSimilarity: number;
  action: ClusterAction;
  winnerUrl: string;
  reason: string;
  members: GroupMember[];
}
interface ClustersMeta {
  totalGroups: number;
  totalPairs: number;
  corpusSize: number;
  groupedPages: number;
  threshold: number;
}

const EVIDENCE_LABEL: Record<EvidenceSignal, string> = {
  body: "Body",
  title: "Title",
  h1: "H1",
  description: "Description",
  url: "URL",
};

export default function ClustersPage() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [meta, setMeta] = useState<ClustersMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters.
  const [actionFilter, setActionFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/groups?limit=200");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load clusters");
      setGroups(data.groups ?? []);
      setMeta({
        totalGroups: data.totalGroups ?? 0,
        totalPairs: data.totalPairs ?? 0,
        corpusSize: data.corpusSize ?? 0,
        groupedPages: data.groupedPages ?? 0,
        threshold: data.threshold ?? 0,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Prefill: run the scan automatically on first visit so the page isn't empty.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: run scan once on mount
  useEffect(() => { load(); }, []);

  const actionTypes = useMemo(
    () => Array.from(new Set((groups ?? []).map((g) => g.action))).sort(),
    [groups],
  );
  const contentTypes = useMemo(
    () => Array.from(new Set((groups ?? []).map((g) => g.members[0]?.type).filter(Boolean) as string[])).sort(),
    [groups],
  );

  const filtered = useMemo(() => {
    if (!groups) return null;
    const needle = q.trim().toLowerCase();
    return groups
      .filter((g) => !actionFilter || g.action === actionFilter)
      .filter((g) => !typeFilter || g.members[0]?.type === typeFilter)
      .filter((g) =>
        !needle ||
        g.members.some((m) =>
          m.url.toLowerCase().includes(needle) || (m.title ?? "").toLowerCase().includes(needle),
        ),
      );
  }, [groups, actionFilter, typeFilter, q]);

  return (
    <div>
      <PageHeader
        title="Content Clusters"
        subtitle="Same-type corpus pages grouped only on multi-signal evidence — body overlap corroborated by title / H1 / description / URL — with a suggested action + winner per cluster."
        right={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-slate-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading ? "Scanning…" : "Rescan"}
          </button>
        }
      />
      <div className="space-y-4 p-8">
        {error && <Card className="border-red-200 bg-red-50 text-sm text-red-700">{error}</Card>}

        {loading && !groups && (
          <Card className="text-sm text-slate-500">Scanning the corpus for near-duplicate clusters…</Card>
        )}

        {meta && (
          <div className="text-xs text-slate-500">
            <strong className="text-slate-700">{meta.totalGroups.toLocaleString()}</strong> clusters ·{" "}
            <strong className="text-slate-700">{meta.groupedPages.toLocaleString()} of {meta.corpusSize.toLocaleString()}</strong>{" "}
            live corpus pages grouped · {meta.totalPairs.toLocaleString()} evidence-backed pairs.
          </div>
        )}

        {/* Filter bar — action pills, content-type pills, text search. */}
        {groups && groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              <FilterPill label={`All ${groups.length}`} active={!actionFilter} onClick={() => setActionFilter("")} />
              {actionTypes.map((a) => (
                <FilterPill
                  key={a}
                  label={`${ACTION_STYLE[a]?.label ?? a} ${groups.filter((g) => g.action === a).length}`}
                  active={actionFilter === a}
                  onClick={() => setActionFilter(actionFilter === a ? "" : a)}
                />
              ))}
            </div>
            <span className="h-4 w-px bg-slate-200" />
            <div className="flex flex-wrap gap-1.5">
              {contentTypes.map((ct) => (
                <FilterPill
                  key={ct}
                  label={`${ct.replace("-", " ")} ${groups.filter((g) => g.members[0]?.type === ct).length}`}
                  active={typeFilter === ct}
                  onClick={() => setTypeFilter(typeFilter === ct ? "" : ct)}
                />
              ))}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title or URL…"
              className="ml-auto w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-slate-900"
            />
          </div>
        )}

        {filtered && filtered.length > 0 && (
          <div className="space-y-2.5">
            {filtered.map((g, i) => <ClusterCard key={`${g.winnerUrl}#${i}`} g={g} />)}
          </div>
        )}
        {filtered && filtered.length === 0 && !loading && (
          <Card className="text-sm text-slate-400">
            {groups && groups.length > 0
              ? "No clusters match the active filters."
              : "No clusters found — no pages are near-duplicates at the current thresholds."}
          </Card>
        )}
      </div>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs capitalize transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function ClusterCard({ g }: { g: GroupSummary }) {
  const [open, setOpen] = useState(false);
  const style = ACTION_STYLE[g.action] ?? ACTION_STYLE.differentiate;
  const shown = open ? g.members : g.members.slice(0, 4);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""} text-slate-400`}>▸</span>
        <span className="text-sm font-semibold text-slate-900">{g.size} pages</span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.cls}`} title={style.hint}>
          {style.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={g.reason}>
          {g.reason}
        </span>
        <span className="ml-auto shrink-0 truncate text-xs text-slate-400" title={`Winner: ${g.winnerUrl}`}>
          winner: <span className="text-slate-600">{pathOf(g.winnerUrl)}</span>
        </span>
      </button>
      <ul className="divide-y divide-slate-50 border-t border-slate-100 px-4 py-1">
        {shown.map((m) => (
          <li key={m.url} className="flex items-start gap-2.5 py-2 text-sm">
            <span
              className={`mt-0.5 w-3 shrink-0 text-center ${m.isWinner ? "text-amber-500" : "text-transparent"}`}
              title={m.isWinner ? "Suggested winner" : undefined}
            >
              ★
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`truncate hover:underline ${m.isWinner ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}
                  title={m.title || m.url}
                >
                  {m.title || pathOf(m.url)}
                </a>
                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${INTENT_STYLE[m.intent] ?? "bg-slate-100 text-slate-500 border-slate-200"}`}>
                  {m.intent ?? "unknown"}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                {m.type && <TypeChip type={m.type} size="xs" />}
                <span className="truncate">{m.url}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className="tabular-nums text-xs font-medium text-slate-500"
                title="Content similarity to this page's closest match in the cluster"
              >
                {(m.matchSim * 100).toFixed(0)}% match
              </span>
              {m.evidence.length > 0 && (
                <span className="flex flex-wrap justify-end gap-1" title="Signals corroborating the grouping">
                  {m.evidence.map((e) => (
                    <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                      {EVIDENCE_LABEL[e] ?? e}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </li>
        ))}
        {!open && g.members.length > 4 && (
          <li className="py-1.5">
            <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-slate-500 hover:text-slate-700">
              + {g.members.length - 4} more
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
