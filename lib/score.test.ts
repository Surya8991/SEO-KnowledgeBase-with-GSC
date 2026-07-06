import { describe, it, expect } from "vitest";
import {
  similarityToBaseScore,
  blendScore,
  conflictTypeFromScore,
} from "@/lib/score";

describe("similarityToBaseScore", () => {
  it("clamps below the noise floor to 0", () => {
    expect(similarityToBaseScore(0.3)).toBe(0);
    expect(similarityToBaseScore(0.55)).toBe(0);
  });
  it("clamps at/above the ceiling to 100", () => {
    expect(similarityToBaseScore(0.95)).toBe(100);
    expect(similarityToBaseScore(1)).toBe(100);
  });
  it("maps the midpoint of the band to ~50", () => {
    expect(similarityToBaseScore(0.75)).toBe(50);
  });
});

describe("blendScore (60% base / 40% LLM)", () => {
  it("returns the base unchanged when LLM score is missing/NaN", () => {
    expect(blendScore(70, undefined)).toBe(70);
    expect(blendScore(70, NaN)).toBe(70);
  });
  it("weights base 0.6 and llm 0.4", () => {
    expect(blendScore(100, 0)).toBe(60);
    expect(blendScore(0, 100)).toBe(40);
    expect(blendScore(50, 100)).toBe(70);
  });
  it("clamps an out-of-range LLM score before blending", () => {
    expect(blendScore(0, 999)).toBe(40); // llm clamped to 100
    expect(blendScore(100, -50)).toBe(60); // llm clamped to 0
  });
});

describe("conflictTypeFromScore", () => {
  it("bands the score into a conflict type", () => {
    expect(conflictTypeFromScore(85)).toBe("duplicate");
    expect(conflictTypeFromScore(70)).toBe("cannibalization");
    expect(conflictTypeFromScore(40)).toBe("partial-overlap");
    expect(conflictTypeFromScore(10)).toBe("none");
  });
});
