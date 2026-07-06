import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { PageHeader, Card } from "@/app/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface StageMix {
  tofu: number;
  mofu: number;
  bofu: number;
  total: number;
}
interface ClusterRow {
  course_type: string;
  category: string;
  tofu: number;
  mofu: number;
  bofu: number;
  total: number;
  clicks_28d: number;
}
interface StrategyData {
  site: StageMix;
  byCourseType: { course_type: string; stages: StageMix }[];
  clusters: ClusterRow[];
  dbReady: boolean;
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

// Centralized — mirrors lib/score-bands.ts intentStage() so a content-type
// rename only needs to update both call sites at once.
const STAGE_CASE_SQL = sql`
  CASE
    WHEN content_type IN ('blog', 'topic')             THEN 'tofu'
    WHEN content_type IN ('category', 'subcategory')   THEN 'mofu'
    WHEN content_type IN ('course', 'mentor')          THEN 'bofu'
    ELSE NULL
  END
`;

async function getData(): Promise<StrategyData> {
  const empty: StrategyData = {
    site: { tofu: 0, mofu: 0, bofu: 0, total: 0 },
    byCourseType: [],
    clusters: [],
    dbReady: false,
  };

  try {
    const { rows: siteRows } = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'tofu')::int AS tofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'mofu')::int AS mofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'bofu')::int AS bofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} IS NOT NULL)::int AS total
      FROM pages
    `);
    const site = siteRows[0] as any;

    const { rows: byTypeRows } = await db.execute(sql`
      SELECT
        course_type,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'tofu')::int AS tofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'mofu')::int AS mofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'bofu')::int AS bofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} IS NOT NULL)::int AS total
      FROM pages
      WHERE course_type IS NOT NULL
      GROUP BY course_type
      ORDER BY total DESC
    `);

    const { rows: clusterRows } = await db.execute(sql`
      SELECT
        course_type,
        category,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'tofu')::int AS tofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'mofu')::int AS mofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} = 'bofu')::int AS bofu,
        COUNT(*) FILTER (WHERE ${STAGE_CASE_SQL} IS NOT NULL)::int AS total,
        SUM(COALESCE(gsc_clicks_28d, 0))::int AS clicks_28d
      FROM pages
      WHERE course_type IS NOT NULL AND category IS NOT NULL
      GROUP BY course_type, category
      HAVING COUNT(*) > 0
      ORDER BY course_type, category
    `);

    return {
      dbReady: true,
      site: {
        tofu: Number(site?.tofu ?? 0),
        mofu: Number(site?.mofu ?? 0),
        bofu: Number(site?.bofu ?? 0),
        total: Number(site?.total ?? 0),
      },
      byCourseType: byTypeRows.map((r: any) => ({
        course_type: r.course_type,
        stages: {
          tofu: Number(r.tofu),
          mofu: Number(r.mofu),
          bofu: Number(r.bofu),
          total: Number(r.total),
        },
      })),
      clusters: clusterRows.map((r: any) => ({
        course_type: r.course_type,
        category: r.category,
        tofu: Number(r.tofu),
        mofu: Number(r.mofu),
        bofu: Number(r.bofu),
        total: Number(r.total),
        clicks_28d: Number(r.clicks_28d ?? 0),
      })),
    };
  } catch {
    return empty;
  }
}

function StageBar({ s }: { s: StageMix }) {
  if (s.total === 0) {
    return <div className="h-2 w-full rounded-full bg-slate-100" />;
  }
  const t = pct(s.tofu, s.total);
  const m = pct(s.mofu, s.total);
  const b = pct(s.bofu, s.total);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="bg-blue-500"    style={{ width: `${t}%` }} title={`TOFU ${t}%`} />
      <div className="bg-violet-500"  style={{ width: `${m}%` }} title={`MOFU ${m}%`} />
      <div className="bg-emerald-500" style={{ width: `${b}%` }} title={`BOFU ${b}%`} />
    </div>
  );
}

function gapBadges(c: ClusterRow): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  if (c.tofu === 0 && c.bofu > 0) out.push({ label: "No TOFU", cls: "bg-blue-100 text-blue-700" });
  if (c.mofu === 0 && c.bofu > 0) out.push({ label: "No MOFU", cls: "bg-violet-100 text-violet-700" });
  if (c.bofu === 0 && (c.tofu + c.mofu) > 0) out.push({ label: "No BOFU", cls: "bg-emerald-100 text-emerald-700" });
  return out;
}

export default async function StrategyPage() {
  const d = await getData();

  if (!d.dbReady) {
    return (
      <div>
        <PageHeader title="Funnel Strategy" subtitle="Top / mid / bottom funnel coverage by cluster." />
        <div className="p-8">
          <Card className="text-sm text-slate-500">Database not reachable.</Card>
        </div>
      </div>
    );
  }

  const gapClusters = d.clusters.filter((c) => gapBadges(c).length > 0);

  return (
    <div>
      <PageHeader
        title="Funnel Strategy"
        subtitle="TOFU / MOFU / BOFU coverage across the catalogue. Surfaces clusters that have product pages (BOFU) but no awareness content (TOFU/MOFU)."
      />
      <div className="space-y-6 p-8">
        {/* Site-wide rollup */}
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Site-wide funnel mix</h3>
            <span className="text-xs text-slate-500 tabular-nums">{d.site.total.toLocaleString()} classified pages</span>
          </div>
          <StageBar s={d.site} />
          <div className="mt-3 grid grid-cols-3 gap-3 text-center text-xs">
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">TOFU</div>
              <div className="text-base font-semibold tabular-nums text-blue-900">{d.site.tofu.toLocaleString()}</div>
              <div className="text-blue-700">{pct(d.site.tofu, d.site.total)}%</div>
            </div>
            <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">MOFU</div>
              <div className="text-base font-semibold tabular-nums text-violet-900">{d.site.mofu.toLocaleString()}</div>
              <div className="text-violet-700">{pct(d.site.mofu, d.site.total)}%</div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">BOFU</div>
              <div className="text-base font-semibold tabular-nums text-emerald-900">{d.site.bofu.toLocaleString()}</div>
              <div className="text-emerald-700">{pct(d.site.bofu, d.site.total)}%</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Healthy mix depends on goals, but a heavy BOFU skew with little TOFU/MOFU usually means awareness traffic
            is starved — clusters below show where the gap is.
          </p>
        </Card>

        {/* By course type */}
        {d.byCourseType.length > 0 && (
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">By course type</h3>
            <div className="space-y-3">
              {d.byCourseType.map((row) => (
                <div key={row.course_type}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium text-slate-700">{row.course_type}</span>
                    <span className="text-slate-500 tabular-nums">
                      {row.stages.total.toLocaleString()} pages ·
                      {" "}T {pct(row.stages.tofu, row.stages.total)}% ·
                      {" "}M {pct(row.stages.mofu, row.stages.total)}% ·
                      {" "}B {pct(row.stages.bofu, row.stages.total)}%
                    </span>
                  </div>
                  <StageBar s={row.stages} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Cluster coverage table */}
        <Card className="p-0">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Cluster coverage</h3>
            <span className="text-xs text-slate-500">
              {gapClusters.length} of {d.clusters.length} clusters have a missing funnel stage
            </span>
          </div>
          {d.clusters.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No clusters classified yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="px-5 py-2 font-medium">Course type</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium text-right">TOFU</th>
                  <th className="px-3 py-2 font-medium text-right">MOFU</th>
                  <th className="px-3 py-2 font-medium text-right">BOFU</th>
                  <th className="px-3 py-2 font-medium text-right">Clicks 28d</th>
                  <th className="px-3 py-2 font-medium">Gaps</th>
                </tr>
              </thead>
              <tbody>
                {d.clusters.map((c) => {
                  const gaps = gapBadges(c);
                  return (
                    <tr key={`${c.course_type}|${c.category}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-2 text-slate-700">{c.course_type}</td>
                      <td className="px-3 py-2 text-slate-700">{c.category}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${c.tofu === 0 ? "text-rose-600 font-semibold" : "text-blue-700"}`}>{c.tofu}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${c.mofu === 0 ? "text-rose-600 font-semibold" : "text-violet-700"}`}>{c.mofu}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${c.bofu === 0 ? "text-rose-600 font-semibold" : "text-emerald-700"}`}>{c.bofu}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{c.clicks_28d.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {gaps.length === 0 ? (
                            <span className="text-xs text-emerald-600">✓ full</span>
                          ) : (
                            gaps.map((g) => (
                              <span key={g.label} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${g.cls}`}>{g.label}</span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <p className="text-xs text-slate-400">
          Stage mapping: blog/topic = TOFU · category/subcategory = MOFU · course/mentor = BOFU.
          Pages with no content_type or one outside this list aren't counted.
        </p>
      </div>
    </div>
  );
}
