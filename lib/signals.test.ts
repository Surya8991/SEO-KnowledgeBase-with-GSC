/** npx tsx --test lib/signals.test.ts */
import { test, assert } from "vitest";
import { tokenize, jaccard, slugTokens, slugOverlap, signalScores } from "./signals";

test("tokenize lowercases, strips punctuation + stopwords", () => {
  assert.deepEqual(tokenize("The Skill-Gap Assessment!"), ["skill", "gap", "assessment"]);
  assert.deepEqual(tokenize("Edstellar and you"), []); // all stop/brand
  assert.deepEqual(tokenize(null), []);
});

test("jaccard overlap", () => {
  assert.equal(jaccard(["a", "b", "c"], ["a", "b", "c"]), 1);
  assert.equal(jaccard(["a", "b"], ["c", "d"]), 0);
  assert.equal(jaccard(["a", "b"], ["a", "c"]), 1 / 3);
  assert.equal(jaccard([], []), 0);
});

test("slugTokens extracts path segments", () => {
  assert.deepEqual(slugTokens("https://www.edstellar.com/blog/skill-gap-analysis"), [
    "blog", "skill", "gap", "analysis",
  ]);
  assert.deepEqual(slugTokens("/templates/training-register"), ["templates", "training", "register"]);
});

test("slugOverlap compares path tokens", () => {
  assert.equal(
    slugOverlap("https://x.com/skill-gap", "https://y.com/skill-gap"),
    1,
  );
  assert.ok(slugOverlap("https://x.com/skill-gap-analysis", "https://x.com/skill-gap") > 0);
});

test("signalScores: identical title, different body = metadata problem", () => {
  const s = signalScores(
    { title: "Skill Gap Analysis", h1: "Skill Gap Analysis", url: "https://x.com/a" },
    { title: "Skill Gap Analysis", h1: "Skill Gap Analysis", url: "https://x.com/b" },
    0.2,
  );
  assert.equal(s.title, 1);
  assert.equal(s.h1, 1);
  assert.equal(s.body, 0.2);
  assert.ok(s.slug < 1); // different last segment
});

test("signalScores: topic input falls back to text vs candidate title", () => {
  const s = signalScores(
    { text: "skill gap competency assessment" },
    { title: "Skill Gap Assessment Guide", h1: null, url: "https://x.com/g" },
    0.7,
  );
  assert.ok(s.title > 0);
  assert.equal(s.h1, 0);
  assert.equal(s.body, 0.7);
});

test("signalScores clamps body to 0..1", () => {
  assert.equal(signalScores({ text: "x" }, { title: "y" }, 1.5).body, 1);
  assert.equal(signalScores({ text: "x" }, { title: "y" }, -0.3).body, 0);
});
