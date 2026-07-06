import { describe, it, expect } from "vitest";
import { secureEquals } from "@/lib/secure-compare";

describe("secureEquals", () => {
  it("returns true for identical strings", () => {
    expect(secureEquals("s3cr3t-key", "s3cr3t-key")).toBe(true);
  });

  it("returns false for different same-length strings", () => {
    expect(secureEquals("aaaaaa", "aaaaab")).toBe(false);
  });

  it("returns false on length mismatch (no throw)", () => {
    expect(secureEquals("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns false when either side is null/undefined/empty", () => {
    expect(secureEquals(null, "x")).toBe(false);
    expect(secureEquals("x", null)).toBe(false);
    expect(secureEquals(undefined, "x")).toBe(false);
    expect(secureEquals("", "")).toBe(false);
    expect(secureEquals("x", "")).toBe(false);
  });

  it("handles multibyte content by byte comparison", () => {
    expect(secureEquals("kéy", "kéy")).toBe(true);
    expect(secureEquals("kéy", "key")).toBe(false);
  });
});
