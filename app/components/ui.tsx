import type { ReactNode } from "react";
import Link from "next/link";
import { scoreBarColor } from "@/lib/score-bands";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-8 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

const TYPE_STYLES: Record<string, string> = {
  duplicate: "bg-red-100 text-red-700",
  cannibalization: "bg-orange-100 text-orange-700",
  "partial-overlap": "bg-amber-100 text-amber-700",
  none: "bg-green-100 text-green-700",
  "needs-review": "bg-slate-100 text-slate-500",
};

/**
 * Audit H16 (Session 6): each conflict-type badge gets a leading glyph so
 * the status is readable for colorblind users + when the page is printed
 * in greyscale. ● = filled (highest severity), ◐ = half (medium),
 * ○ = empty (low/no), ⌛ = needs review.
 */
const TYPE_GLYPHS: Record<string, string> = {
  duplicate: "●",
  cannibalization: "●",
  "partial-overlap": "◐",
  none: "○",
  "needs-review": "⌛",
};

export function ConflictBadge({ type }: { type: string }) {
  const glyph = TYPE_GLYPHS[type];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        TYPE_STYLES[type] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {type}
    </span>
  );
}

/** Color palette for `pages.content_type` values. Single source of truth —
 *  reused by Corpus, Conflict Checker, and any other view that surfaces a type. */
export const TYPE_COLORS: Record<string, string> = {
  course:               "bg-indigo-100 text-indigo-700",
  blog:                 "bg-emerald-100 text-emerald-700",
  category:             "bg-amber-100 text-amber-700",
  subcategory:          "bg-orange-100 text-orange-700",
  location:             "bg-fuchsia-100 text-fuchsia-700",
  "excellence-program": "bg-purple-100 text-purple-700",
  pillar:               "bg-purple-100 text-purple-700",
  home:                 "bg-slate-200 text-slate-700",
  static:               "bg-slate-100 text-slate-600",
};

export function TypeChip({
  type,
  size = "sm",
}: {
  type: string | null | undefined;
  size?: "xs" | "sm";
}) {
  if (!type) return null;
  const cls = TYPE_COLORS[type] ?? "bg-slate-100 text-slate-600";
  const sz = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex rounded font-medium capitalize ${sz} ${cls}`}>
      {type.replace("-", " ")}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  // Audit 10C tokenization: band colors live in lib/score-bands.ts now.
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full ${scoreBarColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums">
        {score}%
      </span>
    </div>
  );
}

/**
 * Audit 10C tokenization (Session 8): single Button component to replace
 * the three parallel style variants littered across pages. Drop-in
 * replacement for `<button>` — same children, same `onClick`, etc.
 *
 *   <Button>             primary   medium
 *   <Button variant="secondary">   bordered
 *   <Button variant="ghost">       transparent hover
 *   <Button size="sm">             tighter padding
 *   <Button size="md">             default
 *
 * The :focus-visible ring from globals.css (audit S8) applies to every
 * variant automatically.
 */
type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-slate-900 text-white shadow-sm hover:bg-slate-800 disabled:opacity-50",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    />
  );
}

/**
 * Audit 10C polish (Session 9): unified Stat component. Previously the
 * dashboard rendered a big Card-shaped KPI tile and the competitors page
 * rendered a small slate-50 inline box — both called `Stat` locally.
 * Two variants live here so existing call sites work without contortions:
 *
 *   <Stat size="lg" label="..." value={n} hint="..." href="/audit" accent="warn" />
 *     headline KPI on the dashboard — big card, optional link + accent
 *
 *   <Stat size="sm" label="..." value="..." />
 *     inline sub-metric in a row — small bordered box, no link/accent
 *
 * `size="lg"` is the default since the dashboard cluster is the more
 * common use. The legacy local Stat definitions in dashboard + competitors
 * pages have been replaced with imports of this component.
 */
type StatAccent = "default" | "warn" | "danger" | "ok";
type StatSize = "lg" | "sm";

const STAT_ACCENT: Record<StatAccent, string> = {
  default: "text-slate-900",
  ok:      "text-emerald-700",
  warn:    "text-amber-600",
  danger:  "text-red-600",
};

export function Stat({
  label,
  value,
  hint,
  accent = "default",
  size = "lg",
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: StatAccent;
  size?: StatSize;
  href?: string;
}) {
  if (size === "sm") {
    // Inline sub-metric — no link, no accent on the value.
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
        <div className="text-base font-semibold text-slate-900">{value}</div>
      </div>
    );
  }
  const body = (
    <>
      <div
        className={`text-3xl font-semibold tracking-tight tabular-nums ${STAT_ACCENT[accent]}`}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
      {hint && <div className="mt-2 text-xs text-slate-400">{hint}</div>}
    </>
  );
  if (!href) return <Card className="h-full">{body}</Card>;
  return (
    <Link href={href} className="block">
      <Card className="h-full transition hover:border-slate-400 hover:shadow">
        {body}
      </Card>
    </Link>
  );
}
