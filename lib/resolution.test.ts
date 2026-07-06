/** npx tsx --test lib/resolution.test.ts */
import { test, assert } from "vitest";
import {
  urlCleanliness,
  pageAuthority,
  pickWinner,
  decidePair,
  groupAction,
  type AuthorityInput,
} from "./resolution";
import type { SignalScores } from "./signals";

const sig = (o: Partial<SignalScores>): SignalScores => ({
  title: 0, h1: 0, slug: 0, body: 0, ...o,
});
const page = (o: Partial<AuthorityInput> & { url: string }): AuthorityInput => ({
  inbound: 0, tokenCount: 0, ...o,
});

test("urlCleanliness: shorter/shallower wins", () => {
  assert.ok(urlCleanliness("https://x.com/a") > urlCleanliness("https://x.com/a/b/c/d/e"));
});

test("pageAuthority rises with inbound links + depth", () => {
  const weak = pageAuthority(page({ url: "https://x.com/a", inbound: 0, tokenCount: 100 }));
  const strong = pageAuthority(page({ url: "https://x.com/a", inbound: 40, tokenCount: 3000 }));
  assert.ok(strong > weak);
});

test("pickWinner selects higher authority", () => {
  const a = page({ url: "https://x.com/weak", inbound: 0, tokenCount: 200 });
  const b = page({ url: "https://x.com/strong", inbound: 30, tokenCount: 2500 });
  assert.equal(pickWinner(a, b).url, "https://x.com/strong");
});

test("different intent → keep-both, no winner", () => {
  const r = decidePair(page({ url: "a" }), page({ url: "b" }), sig({ body: 0.9 }), "informational", "transactional");
  assert.equal(r.action, "keep-both");
  assert.equal(r.winnerUrl, undefined);
});

test("same intent + high body → merge", () => {
  const r = decidePair(
    page({ url: "https://x.com/a", inbound: 1 }),
    page({ url: "https://x.com/b", inbound: 20 }),
    sig({ body: 0.88 }),
    "commercial", "commercial",
  );
  assert.equal(r.action, "merge");
  assert.equal(r.winnerUrl, "https://x.com/b"); // more inbound links
});

test("near-duplicate title triggers merge even at lower body", () => {
  const r = decidePair(
    page({ url: "https://x.com/a" }),
    page({ url: "https://x.com/b" }),
    sig({ body: 0.4, title: 0.9 }),
    "commercial", "commercial",
  );
  assert.equal(r.action, "merge");
});

test("mid body → consolidate", () => {
  const r = decidePair(page({ url: "a" }), page({ url: "b" }), sig({ body: 0.6 }), "informational", "informational");
  assert.equal(r.action, "consolidate");
});

test("low body (below no-conflict floor) → keep-both, not differentiate", () => {
  const r = decidePair(page({ url: "a" }), page({ url: "b" }), sig({ body: 0.4 }), "informational", "informational");
  assert.equal(r.action, "keep-both");
});

test("mid body just above floor + same intent → differentiate", () => {
  const r = decidePair(page({ url: "a" }), page({ url: "b" }), sig({ body: 0.52 }), "informational", "informational");
  assert.equal(r.action, "differentiate");
});

test("topic input (url='') never wins as canonical", () => {
  const topic = page({ url: "", inbound: 0, tokenCount: 3 });
  const weak = page({ url: "https://x.com/a/b/c/d", inbound: 0, tokenCount: 50 });
  assert.equal(pickWinner(topic, weak).url, weak.url);
  const r = decidePair(topic, weak, sig({ body: 0.85 }), "informational", "informational");
  assert.equal(r.action, "merge");
  assert.equal(r.winnerUrl, weak.url); // never ""
});

test("topic input: lexicalMeta=false ignores title near-dup gate", () => {
  // High title Jaccard but low body — must NOT force a merge for a topic input.
  const r = decidePair(
    page({ url: "" }), page({ url: "https://x.com/scrum" }),
    sig({ body: 0.3, title: 1.0 }),
    "commercial", "commercial",
    undefined, false,
  );
  assert.notEqual(r.action, "merge");
});

test("urlCleanliness('') is 0 (absent URL is not clean)", () => {
  assert.equal(urlCleanliness(""), 0);
});

// ── course↔course template-noise gate ─────────────────────────────────────

test("two distinct courses never merge off template-inflated body", () => {
  // Express.js vs Node.js style: body 0.86 (template), title Jaccard 0.5.
  const r = decidePair(
    page({ url: "https://x.com/course/express-js-training" }),
    page({ url: "https://x.com/course/node-js-training" }),
    sig({ body: 0.86, title: 0.5 }),
    "transactional", "transactional",
    undefined, true,
    { input: "course", match: "course" },
  );
  assert.equal(r.action, "keep-both");
  assert.match(r.reason, /template/i);
});

test("true duplicate courses still merge at the hard bar", () => {
  const r = decidePair(
    page({ url: "https://x.com/course/a" }),
    page({ url: "https://x.com/course/b" }),
    sig({ body: 0.95 }),
    "transactional", "transactional",
    undefined, true,
    { input: "course", match: "course" },
  );
  assert.equal(r.action, "merge");
});

test("re-listed course (same title) merges at the softer bar", () => {
  const r = decidePair(
    page({ url: "https://x.com/course/a" }),
    page({ url: "https://x.com/course/b" }),
    sig({ body: 0.89, title: 0.9 }),
    "transactional", "transactional",
    undefined, true,
    { input: "course", match: "course" },
  );
  assert.equal(r.action, "merge");
});

test("non-course pairs are unaffected by the course gate", () => {
  const r = decidePair(
    page({ url: "https://x.com/blog/a" }),
    page({ url: "https://x.com/blog/b" }),
    sig({ body: 0.86 }),
    "informational", "informational",
    undefined, true,
    { input: "blog", match: "blog" },
  );
  assert.equal(r.action, "merge"); // ≥ bodyCosineMerge, no course gate
});

test("groupAction: same intent scales with max similarity", () => {
  assert.equal(groupAction(0.9, ["commercial", "commercial"]), "merge");
  assert.equal(groupAction(0.65, ["commercial", "commercial"]), "consolidate");
  assert.equal(groupAction(0.4, ["commercial", "commercial"]), "differentiate");
});

test("groupAction: mixed intent → differentiate regardless of similarity", () => {
  assert.equal(groupAction(0.95, ["commercial", "informational"]), "differentiate");
});
