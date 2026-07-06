import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { PageHeader, Card, Stat } from "@/app/components/ui";
import { scoreTextColor } from "@/lib/score-bands";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface UserRow {
  created_by: string | null;
  checks_7d: number;
  high_risk_7d: number;
  avg_score_7d: number | null;
}
interface ManagerStats {
  thisWeek: number;
  lastWeek: number;
  highRiskThisWeek: number;
  highRiskLastWeek: number;
  shippedThisWeek: number;
  blockedThisWeek: number;
  unresolvedHighRisk: number;
  outcomes: { outcome: string; n: number }[];
  topInputs: { input_value: string; n: number; top_score: number; created_at: string }[];
  perUser: UserRow[];
  dbReady: boolean;
}

function pct(now: number, prev: number): { sign: "+" | "-" | "·"; value: string; cls: string } {
  if (prev === 0) {
    if (now === 0) return { sign: "·", value: "—", cls: "text-slate-400" };
    return { sign: "+", value: "new", cls: "text-emerald-600" };
  }
  const delta = ((now - prev) / prev) * 100;
  if (Math.abs(delta) < 0.5) return { sign: "·", value: "flat", cls: "text-slate-400" };
  const sign = delta > 0 ? "+" : "-";
  return {
    sign,
    value: `${Math.abs(Math.round(delta))}%`,
    cls: delta > 0 ? "text-emerald-600" : "text-rose-600",
  };
}

async function getStats(): Promise<ManagerStats> {
  const empty: ManagerStats = {
    thisWeek: 0, lastWeek: 0, highRiskThisWeek: 0, highRiskLastWeek: 0,
    shippedThisWeek: 0, blockedThisWeek: 0, unresolvedHighRisk: 0,
    outcomes: [], topInputs: [], perUser: [], dbReady: false,
  };
  try {
    const { rows: weekRows } = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')                              AS this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days') AS last_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'  AND top_score >= 80)         AS hr_this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days' AND top_score >= 80) AS hr_last_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'  AND outcome = 'published')   AS shipped,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'  AND outcome = 'blocked')     AS blocked,
        COUNT(*) FILTER (WHERE top_score >= 80 AND outcome IS NULL AND resolved_at IS NULL)          AS unresolved
      FROM checks
    `);
    const r = weekRows[0] as any;
    const stats: ManagerStats = {
      ...empty,
      dbReady: true,
      thisWeek:        Number(r?.this_week ?? 0),
      lastWeek:        Number(r?.last_week ?? 0),
      highRiskThisWeek: Number(r?.hr_this_week ?? 0),
      highRiskLastWeek: Number(r?.hr_last_week ?? 0),
      shippedThisWeek: Number(r?.shipped ?? 0),
      blockedThisWeek: Number(r?.blocked ?? 0),
      unresolvedHighRisk: Number(r?.unresolved ?? 0),
    };

    const { rows: outcomeRows } = await db.execute(sql`
      SELECT COALESCE(outcome, 'open') AS outcome, COUNT(*)::int AS n
      FROM checks
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY n DESC
    `);
    stats.outcomes = outcomeRows.map((o: any) => ({ outcome: String(o.outcome), n: Number(o.n) }));

    const { rows: topRows } = await db.execute(sql`
      SELECT input_value, COUNT(*)::int AS n, MAX(top_score)::int AS top_score,
             MAX(created_at) AS created_at
      FROM checks
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY input_value
      ORDER BY n DESC, top_score DESC
      LIMIT 10
    `);
    stats.topInputs = topRows.map((r: any) => ({
      input_value: r.input_value,
      n: Number(r.n),
      top_score: Number(r.top_score ?? 0),
      created_at: r.created_at,
    }));

    const { rows: userRows } = await db.execute(sql`
      SELECT created_by,
             COUNT(*)::int AS checks_7d,
             COUNT(*) FILTER (WHERE top_score >= 80)::int AS high_risk_7d,
             AVG(top_score)::float AS avg_score_7d
      FROM checks
      WHERE created_at >= NOW() - INTERVAL '7 days' AND created_by IS NOT NULL
      GROUP BY created_by
      ORDER BY checks_7d DESC
      LIMIT 15
    `);
    stats.perUser = userRows.map((u: any) => ({
      created_by: u.created_by,
      checks_7d: Number(u.checks_7d ?? 0),
      high_risk_7d: Number(u.high_risk_7d ?? 0),
      avg_score_7d: u.avg_score_7d != null ? Number(u.avg_score_7d) : null,
    }));

    return stats;
  } catch {
    return empty;
  }
}

export default async function ManagerPage() {
  const s = await getStats();

  if (!s.dbReady) {
    return (
      <div>
        <PageHeader title="Manager view" subtitle="Team KPIs and pre-publish gate effectiveness." />
        <div className="p-8">
          <Card className="text-sm text-slate-500">
            Database not reachable. Once the connection is back, this page summarizes the last 7 / 14 / 30 days
            of conflict-check activity, per-user volume, and the shipped-vs-blocked outcome breakdown.
          </Card>
        </div>
      </div>
    );
  }

  const checksDelta = pct(s.thisWeek, s.lastWeek);
  const hrDelta = pct(s.highRiskThisWeek, s.highRiskLastWeek);
  const shipRate = s.thisWeek > 0
    ? Math.round((s.shippedThisWeek / s.thisWeek) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        title="Manager view"
        subtitle="Weekly volume, high-risk catches, ship-vs-block outcomes, and per-user activity. Rolling 7 / 14 / 30-day windows."
      />
      <div className="space-y-6 p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Checks · last 7d"
            value={s.thisWeek.toLocaleString()}
            hint={`${checksDelta.sign} ${checksDelta.value} vs prior 7d (${s.lastWeek})`}
          />
          <Stat
            label="High-risk caught · 7d"
            value={s.highRiskThisWeek.toLocaleString()}
            accent={s.highRiskThisWeek > 0 ? "danger" : "ok"}
            hint={`${hrDelta.sign} ${hrDelta.value} vs prior 7d (${s.highRiskLastWeek}) · score ≥80`}
          />
          <Stat
            label="Shipped · 7d"
            value={s.shippedThisWeek.toLocaleString()}
            accent="ok"
            hint={s.thisWeek > 0 ? `${shipRate}% of this week's checks` : "no checks this week"}
          />
          <Stat
            label="Open high-risk"
            value={s.unresolvedHighRisk.toLocaleString()}
            accent={s.unresolvedHighRisk > 0 ? "warn" : "ok"}
            hint="≥80 with no outcome logged"
          />
        </div>

        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Outcome breakdown · last 30 days</h3>
          {s.outcomes.length === 0 ? (
            <p className="text-sm text-slate-500">No checks in the last 30 days.</p>
          ) : (
            <div className="space-y-2">
              {(() => {
                const total = s.outcomes.reduce((a, o) => a + o.n, 0);
                return s.outcomes.map((o) => {
                  const w = total > 0 ? Math.round((o.n / total) * 100) : 0;
                  const cls =
                    o.outcome === "published" ? "bg-emerald-500" :
                    o.outcome === "blocked"   ? "bg-rose-500"    :
                    o.outcome === "modified"  ? "bg-amber-500"   :
                                                 "bg-slate-300";
                  return (
                    <div key={o.outcome} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 capitalize text-slate-700">{o.outcome}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full ${cls}`} style={{ width: `${w}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right tabular-nums text-slate-500">{o.n} ({w}%)</span>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Most-checked inputs · 30d</h3>
            {s.topInputs.length === 0 ? (
              <p className="text-sm text-slate-500">No data.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-2 font-medium">Input</th>
                    <th className="py-2 text-right font-medium">×</th>
                    <th className="py-2 pl-2 text-right font-medium">Best score</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topInputs.map((t, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="max-w-xs truncate py-1.5 pr-2 text-slate-700" title={t.input_value}>{t.input_value}</td>
                      <td className="py-1.5 text-right tabular-nums">{t.n}</td>
                      <td className={`py-1.5 pl-2 text-right tabular-nums font-medium ${scoreTextColor(t.top_score)}`}>{t.top_score}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Per-user activity · 7d</h3>
            {s.perUser.length === 0 ? (
              <p className="text-sm text-slate-500">No attributed checks. Sign in via NextAuth so checks are stamped with your email.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-2 font-medium">User</th>
                    <th className="py-2 text-right font-medium">Checks</th>
                    <th className="py-2 text-right font-medium">High-risk</th>
                    <th className="py-2 pl-2 text-right font-medium">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {s.perUser.map((u, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="max-w-[12rem] truncate py-1.5 pr-2 text-slate-700" title={u.created_by ?? ""}>
                        {u.created_by?.startsWith("anon:") ? <span className="text-slate-400">{u.created_by}</span> : u.created_by}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{u.checks_7d}</td>
                      <td className={`py-1.5 text-right tabular-nums ${u.high_risk_7d > 0 ? "font-semibold text-rose-700" : "text-slate-400"}`}>{u.high_risk_7d}</td>
                      <td className={`py-1.5 pl-2 text-right tabular-nums font-medium ${u.avg_score_7d != null ? scoreTextColor(Math.round(u.avg_score_7d)) : "text-slate-400"}`}>
                        {u.avg_score_7d != null ? Math.round(u.avg_score_7d) + "%" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="text-xs text-slate-400">
          Want a different cut? <Link href="/history" className="underline">Score History</Link> has the full run log;{" "}
          <Link href="/" className="underline">Dashboard</Link> has corpus-wide health.
        </div>
      </div>
    </div>
  );
}
