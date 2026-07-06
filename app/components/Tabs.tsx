"use client";

/**
 * Audit H15 (Session 6): tab strip with URL state sync, role=tablist
 * semantics, and arrow-key keyboard navigation.
 *
 *   - `?tab=<id>` is the source of truth — reload-, share-, back-button
 *     safe. The first render reads the URL; tab clicks call
 *     `router.replace` so the address bar stays current without polluting
 *     history.
 *   - role=tablist + each button as role=tab with aria-selected so screen
 *     readers + keyboard nav (← → Home End) work as users expect.
 *
 * Usage:
 *   <Tabs tabs={[{id:"research", label:"Research"}, …]} param="tab" />
 *   {activeTab === "research" && <ResearchTab/>}
 *
 * The hook variant returns the active id for the page body to switch on.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";

export interface TabDef {
  id: string;
  label: string;
}

export function useActiveTab(
  tabs: readonly TabDef[],
  param = "tab",
): [string, (id: string) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get(param);
  const fallback = tabs[0]?.id ?? "";
  const active = useMemo(() => {
    return tabs.some((t) => t.id === fromUrl) ? (fromUrl as string) : fallback;
  }, [fromUrl, tabs, fallback]);

  const setActive = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(param, id);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, param],
  );

  return [active, setActive];
}

export function Tabs({
  tabs,
  param = "tab",
  className = "",
}: {
  tabs: readonly TabDef[];
  param?: string;
  className?: string;
}) {
  const [active, setActive] = useActiveTab(tabs, param);
  const listId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    refs.current = refs.current.slice(0, tabs.length);
  }, [tabs.length]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const id = tabs[next]?.id;
    if (id) {
      setActive(id);
      refs.current[next]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Sections"
      id={listId}
      onKeyDown={onKeyDown}
      className={`flex flex-wrap gap-1 border-b border-slate-200 ${className}`}
    >
      {tabs.map((t, idx) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            role="tab"
            aria-selected={isActive}
            aria-controls={`${listId}-${t.id}-panel`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setActive(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              isActive
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
