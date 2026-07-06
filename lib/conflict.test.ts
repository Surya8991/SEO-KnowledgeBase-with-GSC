import { describe, it, expect } from "vitest";
import { impactWeighted, type ConflictMatchResult } from "@/lib/conflict";

function match(over: Partial<ConflictMatchResult>): ConflictMatchResult {
  return {
    url: "https://x/a",
    title: null,
    contentType: null,
    similarity: 0.8,
    conflictScore: 100,
    conflictType: "duplicate",
    rationale: "",
    ...over,
  };
}

describe("impactWeighted (audit — regressed once in Session 8)", () => {
  it("returns the base score unchanged with no traffic and no owner", () => {
    expect(impactWeighted(match({ conflictScore: 80 }))).toBe(80);
  });

  it("adds a traffic boost that grows with clicks (log scale)", () => {
    const none = impactWeighted(match({ conflictScore: 100, gscClicks28d: 0 }));
    const some = impactWeighted(match({ conflictScore: 100, gscClicks28d: 100 }));
    const lots = impactWeighted(match({ conflictScore: 100, gscClicks28d: 10_000 }));
    expect(none).toBe(100);
    expect(some).toBeGreaterThan(none);
    expect(lots).toBeGreaterThan(some);
  });

  it("applies the owner-cannibal bonus ONLY when match is a non-owner duplicate", () => {
    // ownerUrl set AND different from url => orphan cannibal => +0.25.
    const cannibal = impactWeighted(
      match({ conflictScore: 100, url: "https://x/dup", ownerUrl: "https://x/canonical" }),
    );
    expect(cannibal).toBe(125);
  });

  it("does NOT apply the bonus when the match IS the owner (regression guard)", () => {
    const owner = impactWeighted(
      match({ conflictScore: 100, url: "https://x/canonical", ownerUrl: "https://x/canonical" }),
    );
    expect(owner).toBe(100);
  });

  it("does not apply the bonus when there is no owner", () => {
    expect(impactWeighted(match({ conflictScore: 100, ownerUrl: null }))).toBe(100);
  });
});
