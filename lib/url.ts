/**
 * Normalise a URL for equality comparison.
 *
 * Two URLs are "the same" if they:
 *   - differ only in protocol (http ↔ https)
 *   - differ only in `www.` prefix
 *   - differ only in trailing slash
 *   - differ only in URL-fragment (#section)
 *   - differ only in casing of the host
 *
 * Returns the original string if it can't be parsed (defensive — never
 * throws on garbage input).
 */
export function normalizeUrl(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${host}${path}${u.search}`;
  } catch {
    // Fallback: lowercase + strip trailing slash + strip protocol/www.
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/#.*$/, "")
      .replace(/\/$/, "");
  }
}

/** True if two URLs resolve to the same canonical target after normalisation. */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeUrl(a) === normalizeUrl(b);
}
