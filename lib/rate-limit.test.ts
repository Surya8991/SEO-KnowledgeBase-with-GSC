import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/rate-limit";

/** Minimal NextRequest stub — clientIp only reads headers.get(). */
function req(headers: Record<string, string>): NextRequest {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null } } as unknown as NextRequest;
}

describe("clientIp (audit H3)", () => {
  it("prefers x-real-ip over x-forwarded-for", () => {
    expect(clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
  });

  it("uses the RIGHTMOST x-forwarded-for hop, never the spoofable leftmost", () => {
    // Attacker sends a fake leftmost value; the trusted proxy appends the real IP.
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("cannot be bucket-split by rotating the leftmost value", () => {
    const a = clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }));
    const b = clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }));
    expect(a).toBe(b);
    expect(a).toBe("203.0.113.7");
  });

  it("falls back to 'unknown' when no forwarding headers present", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});
