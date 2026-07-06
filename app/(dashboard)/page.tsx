import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { readSitemapCsv } from "@/lib/sitemap";
import { PageHeader, Card, ConflictBadge, TypeChip, Stat } from "@/app/components/ui";
import { scoreTextColor, scoreType } from "@/lib/score-bands";

export const dynamic = "force-dynamic";

interface RecentCheck {
  id: number;
  input_type: string;
  input_value: string;
  top_score: number;
  created_at: string;
}
interface TopConflict {
  a_url: string;
  a_title: string | null;
  a_type: string | null;
  b_url: string;
  b_title: string | null;
  b_type: string | null;
  similarity: number;
  pair_type: string;
}
interface DashboardStats {
  sitemapCount: number;
  ingested: number;
  checks: number;
  competitors: number;
  conflictPairs: number;
  highRiskChecks7d: number;
  brokenLinks: number;
  weakHealth: number;
  stalePages: number;
  blocked90d: number;
  published90d: number;
  lastIngest: string | null;
  gscConnected: boolean;
  recentChecks: RecentCheck[];
  topConflicts: TopConflict[];
  dbReady: boolean;
}

async function getStats(): Promise<DashboardStats> {
  let sitemapCount = 0;
  try { sitemapCount = readSitemapCsv().length } catch { /* ignore */ }

  const stats: DashboardStats = {
    sitemapCount,
    ingested: 0, checks: 0, competitors: 0,
    conflictPairs: 0, highRiskChecks7d: 0, brokenLinks: 0, weakHealth: 0,
    stalePages: 0, blocked90d: 0, published90d: 0,
    lastIngest: null, gscConnected: false,
    recentChecks: [], topConflicts: [],
    dbReady: false,
  };

  try {
    const counts = (await db.execute(sql`
      SELECT
        (SELECT count(*) FROM pages)::int                                              AS ingested,
        (SELECT count(*) FROM checks)::int                                             AS checks,
        (SELECT count(*) FROM competitors)::int                                        AS competitors,
        (SELECT count(*) FROM catalog_conflicts)::int                                  AS conflict_pairs,
        (SELECT count(*) FROM checks WHERE top_score >= 80
           AND created_at > now() - interval '7 days')::int                            AS high_risk_7d,
        (SELECT count(*) FROM pages WHERE http_status IS NOT NULL AND http_status >= 400)::int AS broken_links,
        (SELECT count(*) FROM pages WHERE length(coalesce(content_text,'')) < 800)::int AS weak_health,
        (SELECT count(*) FROM pages WHERE is_stale = true)::int                        AS stale_pages,
        (SELECT count(*) FROM checks WHERE outcome IN ('merged','redirected','discarded')
           AND resolved_at > now() - interval '90 days')::int                           AS blocked_90d,
        (SELECT count(*) FROM checks WHERE outcome = 'published'
           AND resolved_at > now() - interval '90 days')::int                           AS published_90d,
        (SELECT max(crawled_at)::text FROM pages)                                      AS last_ingest,
        (SELECT count(*) > 0 FROM gsc_connections)                                     AS gsc_connected
    `)) as any;
    const r = (counts.rows ?? counts)[0];
    stats.ingested = r?.ingested ?? 0;
    stats.checks = r?.checks ?? 0;
    stats.competitors = r?.competitors ?? 0;
    stats.conflictPairs = r?.conflict_pairs ?? 0;
    stats.highRiskChecks7d = r?.high_risk_7d ?? 0;
    stats.brokenLinks = r?.broken_links ?? 0;
    stats.weakHealth = r?.weak_health ?? 0;
    stats.stalePages = r?.stale_pages ?? 0;
    stats.blocked90d = r?.blocked_90d ?? 0;
    stats.published90d = r?.published_90d ?? 0;
    stats.lastIngest = r?.last_ingest ?? null;
    stats.gscConnected = !!r?.gsc_connected;
    stats.dbReady = true;
  } catch { /* DB not set up yet */ }

  if (stats.dbReady) {
    try {
      const recent = (await db.execute(sql`
        SELECT id, input_type, input_value, top_score, created_at::text AS created_at
          FROM checks ORDER BY created_at DESC LIMIT 8
      `)) as any;
      stats.recentChecks = (recent.rows ?? recent) as RecentCheck[];
    } catch { /* ignore */ }
    try {
      const top = (await db.execute(sql`
        SELECT a_url, a_title, a_type, b_url, b_title, b_type, similarity, pair_type
          FROM catalog_conflicts
         WHERE pair_type IN ('duplicate','cannibalization')
         ORDER BY similarity DESC LIMIT 5
      `)) as any;
      stats.topConflicts = (top.rows ?? top) as TopConflict[];
    } catch { /* ignore */ }
  }

  return stats;
}

// Stat moved to @/app/components/ui (Session 9 audit 10C — was duplicated
// here and in /competitors with a different visual treatment; unified
// behind a size="lg|sm" prop).

function pctOfSitemap(n: number, total: number): string {
  if (!total) return "";
  return `${Math.round((n / total) * 100)}% of sitemap`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return iso.slice(0, 10);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// Audit 10C tokenization: lib/score-bands.ts is the single source of truth
// for the 80/60/35 thresholds.

export default async function DashboardHome() {
  const stats = await getStats();

  // System-attention signals — only render if non-zero.
  const attention: { tone: "danger" | "warn" | "info"; text: string; href: string }[] = [];
  if (stats.highRiskChecks7d > 0) {
    attention.push({
      tone: "danger",
      text: `${stats.highRiskChecks7d} check${stats.highRiskChecks7d === 1 ? "" : "s"} scored ≥80 in the last 7 days — review before publishing`,
      href: "/history",
    });
  }
  if (stats.brokenLinks > 0) {
    attention.push({
      tone: "danger",
      text: `${stats.brokenLinks} URL${stats.brokenLinks === 1 ? "" : "s"} returning 4xx/5xx`,
      href: "/audit",
    });
  }
  if (stats.weakHealth > 0) {
    attention.push({
      tone: "warn",
      text: `${stats.weakHealth.toLocaleString()} thin pages (<800 chars of body text)`,
      href: "/audit",
    });
  }
  if (!stats.gscConnected) {
    attention.push({
      tone: "info",
      text: "Search Console not connected — performance tabs are blank",
      href: "/search-console",
    });
  }

  return (
    <div>
      <PageHeader
        title="Content Intelligence Hub"
        subtitle="Conflict detection, Search Console performance, and competitor research for Edstellar."
      />
      <div className="space-y-10 p-8">
        {!stats.dbReady && (
          <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">
            Database not connected yet. Set <code>DATABASE_URL</code> in{" "}
            <code>.env</code>, then run <code>npm run db:setup</code> and{" "}
            <code>npm run ingest</code>.
          </Card>
        )}

        {/* SECTION 1 — Needs attention. Only renders when there's something
            to act on, so the dashboard's empty state isn't a wall of red. */}
        {attention.length > 0 && (
          <section>
            <SectionHeader title="Needs attention" subtitle="Click any item to drill into the relevant tab." />
            <div className="space-y-2">
              {attention.map((a, i) => {
                const tone = {
                  danger: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100",
                  warn:   "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
                  info:   "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                }[a.tone];
                return (
                  <Link key={i} href={a.href}>
                    <Card className={`flex items-center justify-between gap-3 p-3 text-sm transition ${tone}`}>
                      <span>{a.text}</span>
                      <span className="text-xs opacity-70">→</span>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION 2 — Today's signals. The 6 headline counters grouped
            with their own header so they read as one block instead of a
            free-floating tile cloud. */}
        <section>
          <SectionHeader title="Today's signals" subtitle="Corpus state + workload across the team." />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Sitemap URLs"
            value={stats.sitemapCount.toLocaleString()}
            hint="after junk filter"
          />
          <Stat
            label="Pages ingested"
            value={stats.ingested.toLocaleString()}
            hint={stats.lastIngest ? `last: ${relativeTime(stats.lastIngest)}` : undefined}
            href="/corpus"
          />
          <Stat
            label="Checks run"
            value={stats.checks.toLocaleString()}
            href="/history"
          />
          <Stat
            label="High-risk last 7d"
            value={stats.highRiskChecks7d.toLocaleString()}
            hint="score ≥ 80"
            accent={stats.highRiskChecks7d > 0 ? "danger" : "ok"}
            href="/history"
          />
          <Stat
            label="Catalog conflicts"
            value={stats.conflictPairs.toLocaleString()}
            hint="pairs above threshold"
            accent={stats.conflictPairs > 0 ? "warn" : "ok"}
            href="/catalog-conflicts"
          />
          <Stat
            label="Competitor records"
            value={stats.competitors.toLocaleString()}
            href="/competitors"
          />
          </div>
        </section>

        {/* SECTION 3 — Editorial outcomes. Only shows once the team starts
            marking outcomes; explicit header so leadership knows what
            they're looking at when it appears. */}
        {(stats.blocked90d > 0 || stats.published90d > 0 || stats.stalePages > 0) && (
          <section>
            <SectionHeader title="Editorial outcomes (last 90 days)" subtitle="What the team actually did with the checks they ran." />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Stat
                label="Caught"
                value={stats.blocked90d.toLocaleString()}
                hint="merged · redirected · discarded"
                accent="ok"
                href="/history"
              />
              <Stat
                label="Published"
                value={stats.published90d.toLocaleString()}
                hint="conflict check passed"
                href="/history"
              />
              <Stat
                label="Stale"
                value={stats.stalePages.toLocaleString()}
                hint="<5 clicks/28d, lastmod > 12mo"
                accent={stats.stalePages > 0 ? "warn" : "ok"}
                href="/audit"
              />
            </div>
          </section>
        )}

        {/* SECTION 4 — Recent activity. Two parallel feeds: what the team
            has been screening + the worst standing duplicates in the
            catalogue. Empty case suppresses the whole section. */}
        {stats.dbReady && (stats.recentChecks.length > 0 || stats.topConflicts.length > 0) && (
          <section>
            <SectionHeader title="Recent activity" subtitle="Latest checks + worst catalogue conflicts." />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-0">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Recent checks</h2>
                <Link href="/history" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
                  View all →
                </Link>
              </div>
              {stats.recentChecks.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  No checks yet. <Link href="/conflict-checker" className="text-slate-700 underline">Run your first one</Link>.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {stats.recentChecks.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <Link
                        href={`/conflict-checker?input=${encodeURIComponent(c.input_value)}`}
                        className="min-w-0 flex-1 truncate text-slate-700 hover:underline"
                        title={c.input_value}
                      >
                        <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                          {c.input_type}
                        </span>
                        {c.input_value}
                      </Link>
                      <ConflictBadge type={scoreType(c.top_score)} />
                      <span className={`w-12 text-right text-sm font-semibold tabular-nums ${scoreTextColor(c.top_score)}`}>
                        {c.top_score}
                      </span>
                      <span className="w-16 text-right text-xs text-slate-400">{relativeTime(c.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-0">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Top catalog conflicts</h2>
                <Link href="/catalog-conflicts" className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
                  View all →
                </Link>
              </div>
              {stats.topConflicts.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  No conflicts precomputed yet. The weekly catalog cron populates this within 7 days of ingest.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {stats.topConflicts.map((p, i) => (
                    <li key={i} className="space-y-1 px-5 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs">
                          <TypeChip type={p.a_type} size="xs" />
                          <span className="text-slate-300">↔</span>
                          <TypeChip type={p.b_type} size="xs" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-700">
                            {p.pair_type}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-red-600">
                            {Math.round(Number(p.similarity) * 100)}%
                          </span>
                        </div>
                      </div>
                      <a href={p.a_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-slate-700 hover:underline">
                        {p.a_title || p.a_url}
                      </a>
                      <a href={p.b_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-slate-700 hover:underline">
                        {p.b_title || p.b_url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            </div>
          </section>
        )}

        {/* SECTION 5 — Quick actions. Always rendered at the bottom so the
            'what should I do next?' bridge is always one click away. */}
        <section>
          <SectionHeader title="Quick actions" subtitle="Jump straight into the most-used flows." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Action
              href="/conflict-checker"
              title="Check a topic or URL"
              body="Score new content against the corpus before you publish."
            />
            <Action
              href="/search-console"
              title="Search Console"
              body="Pull clicks, impressions & positions from 24h to 12 months."
            />
            <Action
              href="/competitors"
              title="Research competitors"
              body="See who ranks for a topic and how to differentiate."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-slate-200 pb-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-900">{title}</h2>
      {subtitle && <span className="hidden text-xs text-slate-500 sm:inline">{subtitle}</span>}
    </div>
  );
}

function Action({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href}>
      <Card className="h-full transition hover:border-slate-400 hover:shadow">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-500">{body}</div>
      </Card>
    </Link>
  );
}
