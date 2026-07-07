"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PageHeader, Card, TypeChip,
  INTENT_STYLE, ACTION_STYLE, pathOf,
  type Intent, type ClusterAction,
} from "@/app/components/ui";

interface GroupMember {
  url: string;
  title: string | null;
  type: string | null;
  intent: Intent;
  /** IDF-weighted distinctive-topic-token overlap with the cluster seed. */
  matchSim: number;
  /** Body cosine vs the seed (null for the seed itself). */
  bodySim: number | null;
  /** Distinctive topic tokens shared with the seed - the "why grouped" tags. */
  sharedTerms: string[];
  isWinner: boolean;
  isSeed: boolean;
}
interface GroupSummary {
  size: number;
  /** Topic label - the seed's distinctive tokens, e.g. "big data". */
  label: string;
  seedUrl: string;
  action: ClusterAction;
  /** True for a programmatic blog series grouped by slug template. */
  isSeries?: boolean;
  winnerUrl: string;
  maxBodySim: number;
  members: GroupMember[];
}
interface Singleton {
  url: string;
  title: string | null;
  type: string | null;
}
interface ClustersMeta {
  totalGroups: number;
  corpusSize: number;
  groupedPages: number;
  singletonCount: number;
  overlap: number;
}

export default function ClustersPage() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [singletons, setSingletons] = useState<Singleton[]>([]);
  const [meta, setMeta] = useState<ClustersMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters.
  const [actionFilter, setActionFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [q, setQ] = useState("");
  // Search intent is hidden by default (clusters are about topic, not intent);
  // opt in with the checkbox to surface the per-member intent badge.
  const [showIntent, setShowIntent] = useState(false);

  // `fresh` bypasses the server-side scan cache (the Rescan button).
  async function load(fresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups?limit=500${fresh ? "&fresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load clusters");
      setGroups(data.groups ?? []);
      setSingletons(data.singletons ?? []);
      setMeta({
        totalGroups: data.totalGroups ?? 0,
        corpusSize: data.corpusSize ?? 0,
        groupedPages: data.groupedPages ?? 0,
        singletonCount: data.singletonCount ?? 0,
        overlap: data.overlap ?? 0,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Prefill: run the scan automatically on first visit (uses the server cache).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: run scan once on mount
  useEffect(() => { load(); }, []);

  const actionTypes = useMemo(
    () => Array.from(new Set((groups ?? []).map((g) => g.action))).sort(),
    [groups],
  );
  // Every content type that appears in ANY member - a cross-type cluster
  // (category + its courses) must be reachable from the "course" filter too.
  const contentTypes = useMemo(
    () =>
      Array.from(
        new Set((groups ?? []).flatMap((g) => g.members.map((m) => m.type)).filter(Boolean) as string[]),
      ).sort(),
    [groups],
  );

  const filtered = useMemo(() => {
    if (!groups) return null;
    const needle = q.trim().toLowerCase();
    return groups
      .filter((g) => !actionFilter || g.action === actionFilter)
      .filter((g) => !typeFilter || g.members.some((m) => m.type === typeFilter))
      .filter((g) =>
        !needle ||
        g.label.toLowerCase().includes(needle) ||
        g.members.some((m) =>
          m.url.toLowerCase().includes(needle) || (m.title ?? "").toLowerCase().includes(needle),
        ),
      );
  }, [groups, actionFilter, typeFilter, q]);

  return (
    <div>
      <PageHeader
        title="Content Clusters"
        subtitle="Corpus pages grouped by TOPIC across content types - a category page, its blog, and its courses land in one cluster. Distinctive topic tokens (template words auto-learned & dropped) decide membership; each cluster gets a suggested action + winner."
        right={
          <button
            type="button"
            onClick={() => load(true)}
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
          <Card className="text-sm text-slate-500">Scanning the corpus for topic clusters…</Card>
        )}

        {meta && (
          <div className="text-xs text-slate-500">
            <strong className="text-slate-700">{meta.totalGroups.toLocaleString()}</strong> topic clusters ·{" "}
            <strong className="text-slate-700">{meta.groupedPages.toLocaleString()} of {meta.corpusSize.toLocaleString()}</strong>{" "}
            live corpus pages clustered · {meta.singletonCount.toLocaleString()} unique-topic pages.
            {groups && meta.totalGroups > groups.length && (
              <span className="ml-1 font-medium text-amber-700">
                {" "}Showing the largest {groups.length.toLocaleString()} - {(meta.totalGroups - groups.length).toLocaleString()} smaller clusters aren&apos;t listed.
              </span>
            )}
          </div>
        )}

        {/* Filter bar - labeled action / type groups, then controls. */}
        {groups && groups.length > 0 && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <FilterRow label="Action">
              <FilterPill label={`All ${groups.length}`} active={!actionFilter} onClick={() => setActionFilter("")} />
              {actionTypes.map((a) => (
                <FilterPill
                  key={a}
                  label={`${ACTION_STYLE[a]?.label ?? a} ${groups.filter((g) => g.action === a).length}`}
                  active={actionFilter === a}
                  onClick={() => setActionFilter(actionFilter === a ? "" : a)}
                />
              ))}
            </FilterRow>
            <FilterRow label="Type">
              <FilterPill label="All" active={!typeFilter} onClick={() => setTypeFilter("")} />
              {contentTypes.map((ct) => (
                <FilterPill
                  key={ct}
                  label={`${ct.replace("-", " ")} ${groups.filter((g) => g.members.some((m) => m.type === ct)).length}`}
                  active={typeFilter === ct}
                  onClick={() => setTypeFilter(typeFilter === ct ? "" : ct)}
                />
              ))}
            </FilterRow>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={showIntent} onChange={(e) => setShowIntent(e.target.checked)} />
                show intent
              </label>
              {(actionFilter || typeFilter || q) && (
                <button
                  type="button"
                  onClick={() => { setActionFilter(""); setTypeFilter(""); setQ(""); }}
                  className="text-xs text-slate-500 underline decoration-dotted hover:text-slate-700"
                >
                  clear filters
                </button>
              )}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by topic, title, or URL…"
                className="ml-auto w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-slate-900"
              />
            </div>
          </div>
        )}

        {filtered && filtered.length > 0 && (
          <div className="space-y-2.5">
            {filtered.map((g, i) => <ClusterCard key={`${g.seedUrl}#${i}`} g={g} showIntent={showIntent} />)}
          </div>
        )}
        {filtered && filtered.length === 0 && !loading && (
          <Card className="text-sm text-slate-400">
            {groups && groups.length > 0
              ? "No clusters match the active filters."
              : "No clusters found - no pages share a topic at the current thresholds."}
          </Card>
        )}

        {/* Unique-topic (singleton) pages - browsable, not a dead-end stat. */}
        {meta && meta.singletonCount > 0 && (
          <SingletonsSection singletons={singletons} total={meta.singletonCount} q={q} />
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
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

function ClusterCard({ g, showIntent }: { g: GroupSummary; showIntent: boolean }) {
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
        {g.isSeries && (
          <span
            className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700"
            title="Programmatic blog series grouped by URL template - intentional variants, keep them all"
          >
            series
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800"
          title={g.isSeries ? `Series: ${g.label}` : `Topic: ${g.label} · pillar: ${pathOf(g.seedUrl)}`}
        >
          {g.label}
        </span>
        <span className="ml-auto shrink-0 truncate text-xs text-slate-400" title={`Suggested winner: ${g.winnerUrl}`}>
          winner: <span className="text-slate-600">{pathOf(g.winnerUrl)}</span>
        </span>
      </button>
      <ul className="divide-y divide-slate-50 border-t border-slate-100 px-4 py-1">
        {shown.map((m) => (
          <li key={m.url} className="flex items-start gap-2.5 py-2 text-sm">
            <span
              className={`mt-0.5 w-3 shrink-0 text-center ${m.isWinner ? "text-amber-500" : "text-transparent"}`}
              title={m.isWinner ? "Suggested winner (canonical page to keep)" : undefined}
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
                {m.isSeed && !g.isSeries && (
                  <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700" title="Pillar - the topic hub for this cluster">
                    pillar
                  </span>
                )}
                {showIntent && (
                  <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${INTENT_STYLE[m.intent] ?? "bg-slate-100 text-slate-500 border-slate-200"}`}>
                    {m.intent ?? "unknown"}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                {m.type && <TypeChip type={m.type} size="xs" />}
                <span className="truncate">{m.url}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {g.isSeries ? null : m.isSeed ? (
                <span className="text-xs font-medium text-purple-600">pillar</span>
              ) : (
                <span
                  className="tabular-nums text-sm font-semibold text-slate-700"
                  title={`Content similarity to the pillar (embedding cosine). Distinctive-topic-token overlap: ${(m.matchSim * 100).toFixed(0)}%`}
                >
                  {m.bodySim != null ? `${(m.bodySim * 100).toFixed(0)}%` : `${(m.matchSim * 100).toFixed(0)}%`}
                  <span className="ml-1 text-[10px] font-normal text-slate-400">match</span>
                </span>
              )}
              {m.sharedTerms.length > 0 && (
                <span className="flex flex-wrap justify-end gap-1" title="Distinctive topic tokens shared with the pillar">
                  {m.sharedTerms.slice(0, 4).map((term) => (
                    <span key={term} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                      {term}
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

function SingletonsSection({ singletons, total, q }: { singletons: Singleton[]; total: number; q: string }) {
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  const list = needle
    ? singletons.filter((s) => s.url.toLowerCase().includes(needle) || (s.title ?? "").toLowerCase().includes(needle))
    : singletons;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""} text-slate-400`}>▸</span>
        <span className="text-sm font-semibold text-slate-900">{total.toLocaleString()} unique-topic pages</span>
        <span className="truncate text-xs text-slate-400">pages whose topic no other page shares - an answer, not a gap</span>
      </button>
      {open && (
        <ul className="max-h-96 divide-y divide-slate-50 overflow-auto border-t border-slate-100 px-4 py-1">
          {list.slice(0, 500).map((s) => (
            <li key={s.url} className="flex items-center gap-2 py-1.5 text-sm">
              {s.type && <TypeChip type={s.type} size="xs" />}
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="truncate font-medium text-slate-800 hover:underline"
                title={s.title || s.url}
              >
                {s.title || pathOf(s.url)}
              </a>
              <span className="ml-auto shrink-0 truncate text-xs text-slate-400">{pathOf(s.url)}</span>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-2 text-xs text-slate-400">No unique-topic pages match the filter.</li>
          )}
          {!needle && total > singletons.length && (
            <li className="py-2 text-[11px] text-amber-700">
              Showing the first {singletons.length.toLocaleString()} of {total.toLocaleString()}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
