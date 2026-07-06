"use client";

/**
 * Audit H14 (Session 6): minimal in-house toast — no new dep. Replaces
 * the `alert()` modal that blocked the page on every "copy brief" click.
 *
 * Usage: import { useToast } from "@/app/components/Toast" at the page
 * level; render <ToastViewport/> once near the layout root; call
 * `toast.success("…")` / `toast.error("…")` from any client component.
 *
 * Implementation is intentionally tiny — single global emitter, fade
 * after 4s, max 3 visible. If we ever need queueing, undo actions, or
 * promise-based toasts we can adopt sonner (~4 KB) at that point.
 */
import { useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  for (const l of listeners) l(items);
}

function push(kind: ToastKind, message: string) {
  const id = nextId++;
  items = [...items.slice(-2), { id, kind, message }];
  notify();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    notify();
  }, 4000);
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m),
  info: (m: string) => push("info", m),
};

const KIND_CLASS: Record<ToastKind, string> = {
  success: "bg-emerald-50 border-emerald-200 text-emerald-900",
  error: "bg-red-50 border-red-200 text-red-900",
  info: "bg-slate-50 border-slate-200 text-slate-900",
};

export function ToastViewport() {
  const [visible, setVisible] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l: Listener = (xs) => setVisible([...xs]);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!visible.length) return null;
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {visible.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm font-medium shadow-md ${KIND_CLASS[t.kind]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
