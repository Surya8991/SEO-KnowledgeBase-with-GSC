import { describe, it, expect } from "vitest";
import { assertSafeOutboundUrl, SsrfBlockedError } from "@/lib/ssrf-guard";

// Only literal-IP and scheme paths are exercised here — they need no DNS, so
// the suite stays hermetic. Hostname resolution is covered by the callers'
// integration paths.

describe("assertSafeOutboundUrl — scheme (audit C1)", () => {
  for (const bad of ["file:///etc/passwd", "gopher://x", "ftp://x/y", "data:text/plain,hi"]) {
    it(`rejects scheme: ${bad}`, async () => {
      await expect(assertSafeOutboundUrl(bad)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  }

  it("rejects a malformed URL", async () => {
    await expect(assertSafeOutboundUrl("not a url")).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("assertSafeOutboundUrl — forbidden literal IPs (audit C1)", () => {
  const forbidden = [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://100.64.0.1/", // CGNAT
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:169.254.169.254]/", // ipv4-mapped metadata
  ];
  for (const url of forbidden) {
    it(`blocks ${url}`, async () => {
      await expect(assertSafeOutboundUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  }

  it("blocks the localhost hostname", async () => {
    await expect(assertSafeOutboundUrl("http://localhost:8080/")).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("assertSafeOutboundUrl — allows public literal IPs", () => {
  it("permits a public IPv4 literal", async () => {
    const { ip } = await assertSafeOutboundUrl("http://8.8.8.8/");
    expect(ip).toBe("8.8.8.8");
  });
});
