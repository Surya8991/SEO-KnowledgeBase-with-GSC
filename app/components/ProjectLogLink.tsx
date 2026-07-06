/**
 * Top-right Project Log link (Session 10).
 *
 * User request: surface PROJECTLOG.md somewhere visible from the
 * dashboard. Fixed top-right, low z-index so the help bubble (bottom-
 * right) and toasts (bottom-center) don't fight with it. Opens the
 * GitHub-rendered version of PROJECTLOG.md in a new tab so the markdown
 * renders properly without us having to ship an in-app viewer.
 *
 * If the repo ever moves to a private GitHub or an internal mirror,
 * swap the href to a fetched-and-rendered version of /PROJECTLOG.md.
 */
import { BookOpen } from "lucide-react";

const HREF =
  "https://github.com/Layruss98266/Edstellar-Conflict-Checker-KnowledgeBase/blob/main/PROJECTLOG.md";

export default function ProjectLogLink() {
  return (
    <a
      href={HREF}
      target="_blank"
      rel="noreferrer"
      title="Project log — session-by-session shipping record"
      className="fixed right-5 top-5 z-30 hidden items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur transition hover:border-slate-300 hover:bg-white hover:text-slate-900 sm:inline-flex"
    >
      <BookOpen size={14} aria-hidden="true" />
      Project log
    </a>
  );
}
