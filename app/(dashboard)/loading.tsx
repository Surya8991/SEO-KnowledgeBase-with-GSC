/**
 * Audit S7 (Session 6): dashboard segment loader. The root dashboard page
 * fans 11 SQL queries before first paint; without this the user sees a blank
 * screen for the full duration of the slowest query. Skeleton mirrors the
 * stat-grid + section layout so the visual jump is small when real data
 * lands.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-10 p-8">
      <div className="space-y-3">
        <div className="skeleton h-7 w-64" />
        <div className="skeleton h-4 w-96" />
      </div>

      <section className="space-y-4">
        <div className="skeleton h-4 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="skeleton mb-3 h-3 w-24" />
              <div className="skeleton h-7 w-20" />
              <div className="skeleton mt-3 h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="skeleton h-4 w-40" />
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-slate-100 py-3 last:border-0"
            >
              <div className="skeleton h-4 w-16" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-4 w-12" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
