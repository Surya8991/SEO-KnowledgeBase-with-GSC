"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ScanSearch,
  Layers,
  Link2,
  ClipboardCheck,
  History,
  LineChart,
  Swords,
  Database,
  GitCompareArrows,
  BarChart3,
  Compass,
  Menu,
  X,
} from "lucide-react";

interface SidebarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

const NAV: { href: string; label: string; icon: any }[] = [
  { href: "/",                   label: "Dashboard",         icon: LayoutDashboard },
  { href: "/manager",            label: "Manager View",      icon: BarChart3 },
  { href: "/conflict-checker",   label: "Conflict Checker",  icon: ScanSearch },
  { href: "/bulk-check",         label: "Bulk Check",        icon: Layers },
  { href: "/history",            label: "Score History",     icon: History },
  { href: "/catalog-conflicts",  label: "Catalog Conflicts", icon: GitCompareArrows },
  { href: "/search-console",     label: "Search Console",    icon: LineChart },
  { href: "/competitors",        label: "Competitors",       icon: Swords },
  { href: "/corpus",             label: "Corpus",            icon: Database },
];

const ADDITIONAL_NAV: { href: string; label: string; icon: any }[] = [
  { href: "/audit",              label: "Content Audit",     icon: ClipboardCheck },
  { href: "/internal-links",     label: "Internal Links",    icon: Link2 },
  { href: "/strategy",           label: "Funnel Strategy",   icon: Compass },
];

export default function Sidebar({ user, signOutSlot }: { user?: SidebarUser | null; signOutSlot?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on route change so the user lands on the new page.
  useEffect(() => { setOpen(false) }, [pathname]);

  return (
    <>
      {/* Mobile / narrow viewport burger. Audit H17 (Session 6): hidden
          while the drawer is open so the tap target doesn't sit on top of
          the drawer header (and so screen readers don't see two
          "open/close navigation" controls at once). */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={false}
          aria-controls="sidebar-drawer"
          className="fixed left-3 top-3 z-40 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm lg:hidden"
        >
          <Menu size={16} />
          Menu
        </button>
      )}

      {/* Backdrop for the mobile drawer. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      )}

      {/* Sidebar. Drawer on small, static on >= lg. Audit H18: when the
          drawer is open on narrow viewports, surface it as a modal dialog
          so assistive tech treats it correctly. The `lg:` static layout
          isn't modal — only the mobile drawer is. */}
      <aside
        id="sidebar-drawer"
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? "Navigation" : undefined}
        className={`
          fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white
          transform transition-transform duration-200
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:static lg:translate-x-0
        `}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/mark.svg"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 shrink-0"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight text-slate-900">
                Edstellar
              </div>
              <div className="truncate text-[11px] text-slate-500">Content Intelligence</div>
            </div>
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="ml-2 rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="space-y-1 overflow-y-auto p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            // Audit 10C polish (Session 8): exact-or-boundary match so a
            // future `/audit-archive` route doesn't false-positive as
            // active when the user is on `/audit`. `startsWith(href + "/")`
            // requires a path-segment boundary, not just a substring.
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}

          <div className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Additional Tools
          </div>
          {ADDITIONAL_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="mt-auto border-t border-slate-200 p-3">
            <div className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-7 w-7 rounded-full" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                  {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-700">{user.name || "Signed in"}</div>
                <div className="truncate text-[11px] text-slate-400">{user.email}</div>
              </div>
            </div>
            {signOutSlot}
          </div>
        )}
      </aside>
    </>
  );
}
