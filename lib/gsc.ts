import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/gsc/callback";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(state?: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GSC_SCOPE],
    ...(state ? { state } : {}),
  });
}

/** Persist tokens from the OAuth callback. */
export async function saveTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
}) {
  const sql = neon(process.env.DATABASE_URL!);
  const siteUrl = process.env.GSC_SITE_URL || "";
  await sql.query(
    `INSERT INTO gsc_connections (site_url, access_token, refresh_token, expiry, scope)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      siteUrl,
      tokens.access_token ?? null,
      tokens.refresh_token ?? null,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      tokens.scope ?? GSC_SCOPE,
    ],
  );
}

/** Load the most recent stored connection and return an authorized client. */
export async function getAuthorizedClient() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql.query(
    `SELECT access_token, refresh_token, expiry FROM gsc_connections
     ORDER BY created_at DESC LIMIT 1`,
  )) as any[];
  if (!rows.length) return null;
  const client = getOAuthClient();
  client.setCredentials({
    access_token: rows[0].access_token,
    refresh_token: rows[0].refresh_token,
    expiry_date: rows[0].expiry ? new Date(rows[0].expiry).getTime() : undefined,
  });
  return client;
}

export type RangeKey = "24h" | "7d" | "28d" | "3m" | "6m" | "12m" | "custom";

/** YYYY-MM-DD strict guard. */
export function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
}

/** Resolve a preset range to start/end YYYY-MM-DD strings.
 *  GSC has ~2-3 day data latency; "24h" maps to the most recent 2 days.
 *
 *  When `range === "custom"`, callers must pass `custom = { startDate, endDate }`.
 *  GSC enforces ≤16 months of history; we soft-clamp the start to that window. */
export function resolveRange(
  range: RangeKey,
  today = new Date(),
  custom?: { startDate?: string; endDate?: string },
): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  if (range === "custom") {
    if (!custom || !isValidDateString(custom.startDate) || !isValidDateString(custom.endDate)) {
      throw new Error("Custom range requires startDate and endDate (YYYY-MM-DD).");
    }
    if (custom.startDate > custom.endDate) {
      throw new Error("Custom range: startDate must be on or before endDate.");
    }
    // Soft-clamp to GSC's 16-month window so the API doesn't 400.
    const maxBack = new Date(today);
    maxBack.setMonth(maxBack.getMonth() - 16);
    const minStart = fmt(maxBack);
    const start = custom.startDate < minStart ? minStart : custom.startDate;
    // Don't allow endDate in the future — GSC will 400.
    const todayStr = fmt(today);
    const end = custom.endDate > todayStr ? todayStr : custom.endDate;
    return { startDate: start, endDate: end };
  }

  const end = new Date(today);
  const start = new Date(today);
  const daysByRange: Record<Exclude<RangeKey, "custom">, number> = {
    "24h": 2,
    "7d": 7,
    "28d": 28,
    "3m": 90,
    "6m": 180,
    "12m": 365,
  };
  start.setDate(end.getDate() - daysByRange[range]);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export interface GscQueryOptions {
  range: RangeKey;
  dimensions?: ("query" | "page" | "date" | "country" | "device")[];
  rowLimit?: number;
}

export async function querySearchAnalytics(opts: GscQueryOptions) {
  const client = await getAuthorizedClient();
  if (!client) throw new Error("Not connected to Google Search Console.");
  const siteUrl = await resolveSiteUrl(client);

  const { startDate, endDate } = resolveRange(opts.range);
  const webmasters = google.webmasters({ version: "v3", auth: client });
  const res = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: opts.dimensions ?? ["query"],
      rowLimit: opts.rowLimit ?? 100,
    },
  });
  return { startDate, endDate, rows: res.data.rows ?? [] };
}

/**
 * Build the candidate property URLs we'll probe against the connected
 * account's verified-sites list.
 *
 * GSC distinguishes URL-prefix properties (must match scheme + host + path
 * EXACTLY, including trailing slash) from Domain properties
 * (`sc-domain:example.com` — covers all subdomains and schemes). The user only
 * configures one `GSC_SITE_URL` value, but the property that's actually
 * verified for their account might be any of these variants. We try them all.
 */
export function siteUrlCandidates(envValue: string): string[] {
  const v = envValue.trim();
  if (!v) return [];
  const out = new Set<string>();
  // 1. Exactly what was configured (URL-prefix or sc-domain).
  out.add(v);
  // 2. Toggled trailing slash (URL-prefix only).
  if (/^https?:\/\//i.test(v)) {
    out.add(v.endsWith("/") ? v.replace(/\/+$/, "") : v + "/");
  }
  // 3. Domain-property fallback derived from the host.
  try {
    if (/^https?:\/\//i.test(v)) {
      const host = new URL(v).hostname;
      out.add(`sc-domain:${host}`);
      out.add(`sc-domain:${host.replace(/^www\./, "")}`);
    }
  } catch {
    /* not a URL — that's fine */
  }
  return [...out];
}

// Module-level cache. First request through resolveSiteUrl probes the API;
// every subsequent call in the same lambda instance returns the cached value.
// Vercel functions reuse instances, so this typically only probes once per
// cold start.
let cachedResolvedSiteUrl: string | null = null;
let cachedForCreds: string | null = null;
function credsFingerprint(client: any): string {
  // Cheap fingerprint so we re-probe if a different account connects.
  const c = client?.credentials ?? {};
  return `${c.access_token?.slice(-12) ?? ""}|${c.refresh_token?.slice(-12) ?? ""}`;
}

/**
 * Pick a siteUrl variant the connected account actually has permission for.
 * Throws a helpful error listing what IS verified if none of the candidates
 * match — saves the "User does not have sufficient permission" debug loop.
 */
export async function resolveSiteUrl(client: any): Promise<string> {
  const env = process.env.GSC_SITE_URL;
  if (!env) throw new Error("GSC_SITE_URL is not set.");

  const fp = credsFingerprint(client);
  if (cachedResolvedSiteUrl && cachedForCreds === fp) return cachedResolvedSiteUrl;

  const candidates = siteUrlCandidates(env);
  const webmasters = google.webmasters({ version: "v3", auth: client });
  const list = await webmasters.sites.list();
  const verified = (list.data.siteEntry ?? [])
    .filter((e) => e.permissionLevel && e.permissionLevel !== "siteUnverifiedUser")
    .map((e) => e.siteUrl!)
    .filter(Boolean);

  // Match case-insensitive on URL-prefix and exact on sc-domain.
  const match = candidates.find((c) =>
    verified.some((v) =>
      c.startsWith("sc-domain:") ? v === c : v.toLowerCase() === c.toLowerCase(),
    ),
  );

  if (!match) {
    const tried = candidates.join(", ");
    const haveAccess = verified.length
      ? verified.join(", ")
      : "(none — this Google account has no verified Search Console properties)";
    throw new Error(
      `GSC_SITE_URL='${env}' does not match any property this Google account can access. ` +
        `Tried: ${tried}. Account has access to: ${haveAccess}. ` +
        `Fix: in Search Console, add this account as a user on the property, ` +
        `OR set GSC_SITE_URL to one of the accessible properties listed above.`,
    );
  }

  cachedResolvedSiteUrl = match;
  cachedForCreds = fp;
  return match;
}
