/**
 * SSRF guard for user-supplied URLs (audit S3, Session 6).
 *
 * Before fetching any URL the user provided we:
 *   1. Reject non-http(s) schemes (file:, gopher:, ftp:, data:, etc.).
 *   2. Reject anything resolving to RFC1918 private space, loopback,
 *      link-local (incl. AWS/GCP/Azure metadata 169.254.169.254), or
 *      multicast/reserved blocks.
 *   3. Resolve the hostname via DNS; if ANY A/AAAA record is forbidden,
 *      reject. (Belt-and-braces against DNS-rebind: callers must use the
 *      returned IP for the actual fetch, OR re-validate on redirect.)
 *
 * Returns the validated URL and resolved IP for callers who want to bind to
 * the IP. Throws SsrfBlockedError on rejection so the caller's catch block
 * surfaces a clean 400, not a 500.
 */
import { promises as dns } from "node:dns";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`Blocked outbound request: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.azure.com",
  "instance-data",
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isForbiddenIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true;
  // 0.0.0.0/8 (current network) and 255.255.255.255 broadcast
  if ((n >>> 24) === 0) return true;
  if (n === 0xffffffff) return true;
  // 10.0.0.0/8
  if ((n >>> 24) === 10) return true;
  // 127.0.0.0/8 loopback
  if ((n >>> 24) === 127) return true;
  // 169.254.0.0/16 link-local (covers 169.254.169.254 cloud-metadata)
  if ((n >>> 16) === 0xa9fe) return true;
  // 172.16.0.0/12
  if ((n >>> 20) === 0xac1) return true;
  // 192.168.0.0/16
  if ((n >>> 16) === 0xc0a8) return true;
  // 224.0.0.0/4 multicast
  if ((n >>> 28) === 0xe) return true;
  // 240.0.0.0/4 reserved
  if ((n >>> 28) === 0xf) return true;
  // 100.64.0.0/10 CGNAT
  if ((n >>> 22) === 0x191) return true;
  return false;
}

function isForbiddenIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 loopback, :: unspecified
  if (lower === "::1" || lower === "::") return true;
  // fc00::/7 unique local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 link-local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ff00::/8 multicast
  if (lower.startsWith("ff")) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — extract and check
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isForbiddenIpv4(v4Mapped[1]!);
  return false;
}

function isForbiddenIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return isForbiddenIpv4(ip);
  if (fam === 6) return isForbiddenIpv6(ip);
  return true;
}

export interface SsrfCheckResult {
  url: URL;
  /** First resolved IP for the host; useful if caller wants to bind. */
  ip: string;
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`scheme ${url.protocol} not allowed`);
  }
  const host = url.hostname.toLowerCase();
  if (FORBIDDEN_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`hostname ${host} not allowed`);
  }
  // If the URL is a literal IP, validate directly.
  if (net.isIP(host)) {
    if (isForbiddenIp(host)) {
      throw new SsrfBlockedError(`IP ${host} in forbidden range`);
    }
    return { url, ip: host };
  }
  // Resolve and validate every record.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(`DNS lookup failed for ${host}`);
  }
  if (!addresses.length) {
    throw new SsrfBlockedError(`no DNS records for ${host}`);
  }
  for (const a of addresses) {
    if (isForbiddenIp(a.address)) {
      throw new SsrfBlockedError(`${host} resolves to forbidden ${a.address}`);
    }
  }
  return { url, ip: addresses[0]!.address };
}
