/** npx tsx --test lib/cluster.test.ts */
import { test, assert } from "vitest";
import { connectedComponents, shouldGroupPair, evaluatePair, type EvidenceSignal } from "./cluster";

test("transitive edges form one component", () => {
  // A-B, B-C ⇒ {A,B,C} even though A-C was never a direct edge.
  const groups = connectedComponents([["a", "b"], ["b", "c"]]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["a", "b", "c"]);
});

test("disjoint edges form separate components", () => {
  const groups = connectedComponents([["a", "b"], ["x", "y"], ["y", "z"]]);
  assert.equal(groups.length, 2);
  // Largest first: {x,y,z} before {a,b}.
  assert.deepEqual(groups[0], ["x", "y", "z"]);
  assert.deepEqual(groups[1], ["a", "b"]);
});

test("no edges ⇒ no components (singletons omitted)", () => {
  assert.deepEqual(connectedComponents([]), []);
});

test("extraNodes with no edges appear as singletons", () => {
  const groups = connectedComponents([["a", "b"]], ["solo"]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], ["a", "b"]);
  assert.deepEqual(groups[1], ["solo"]);
});

test("duplicate edges don't duplicate members", () => {
  const groups = connectedComponents([["a", "b"], ["a", "b"], ["b", "a"]]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["a", "b"]);
});

test("chained merge across many edges", () => {
  const groups = connectedComponents([
    ["1", "2"], ["3", "4"], ["2", "3"], ["5", "6"],
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], ["1", "2", "3", "4"]);
  assert.deepEqual(groups[1], ["5", "6"]);
});

// ── evaluatePair — topic-first grouping (rewritten) ───────────────────────
// Grouping means SAME TOPIC (slug/title/H1 subject overlap), not same type or
// high body cosine. Cross-type same-topic pairs group; same-type different-topic
// pairs (template-inflated body) do not.

test("cross-type SAME topic groups (category listing + blog)", () => {
  // The headline fix: /category/big-data-training + /blog/big-data-training-companies.
  const r = evaluatePair({
    aType: "category", bType: "blog",
    aTitle: "Big Data Training", bTitle: "Top Big Data Training Companies",
    aUrl: "https://x.com/category/big-data-training",
    bUrl: "https://x.com/blog/big-data-training-companies",
    sim: 0.7,
  });
  assert.equal(r.group, true);
  assert.ok(r.support.includes("title"));
  assert.ok(r.support.includes("url"));
});

test("same-type DIFFERENT topics do NOT group despite template-inflated body", () => {
  // Two category pages; boilerplate gives 94% body cosine, but the subjects
  // differ (big data vs python) → no topic anchor → the old "40 category
  // pages" false cluster no longer forms.
  const r = evaluatePair({
    aType: "category", bType: "category",
    aTitle: "Big Data Training", bTitle: "Python Training",
    aUrl: "https://x.com/category/big-data-training",
    bUrl: "https://x.com/category/python-training",
    sim: 0.94,
  });
  assert.equal(r.group, false);
});

test("high body cosine with zero subject overlap never groups (template noise)", () => {
  // /enquiry-form vs /contact-us: 94% template body, no shared subject.
  const r = evaluatePair({
    aType: "static", bType: "static",
    aTitle: "Enquire Now", bTitle: "Contact Us",
    aH1: "Enquiry", bH1: "Reach Our Team",
    aUrl: "https://x.com/enquiry-form", bUrl: "https://x.com/contact-us",
    sim: 0.94,
  });
  assert.equal(r.group, false);
  assert.deepEqual(r.support, []);
});

test("a single generic shared word is not a topic anchor", () => {
  // "big data training" vs "python training" share only {training} (Jaccard
  // 0.25 < anchor) → different topics even at high body cosine.
  const r = evaluatePair({
    aType: "course", bType: "course",
    aTitle: "Big Data Training", bTitle: "Python Training",
    aUrl: "https://x.com/course/big-data-training", bUrl: "https://x.com/course/python-training",
    sim: 0.9,
  });
  assert.equal(r.group, false);
});

test("topic match but unrelated body (below floor) does NOT group", () => {
  const r = evaluatePair({
    aType: "blog", bType: "blog",
    aTitle: "Leadership Skills Training", bTitle: "Leadership Skills Training",
    sim: 0.4, // below groupBodyFloor
  });
  assert.equal(r.group, false);
});

test("plural normalization anchors 'skill gaps' vs 'skills gap'", () => {
  const r = evaluatePair({
    aType: "blog", bType: "blog",
    aTitle: "Identify Skill Gaps at Work", bTitle: "Skills Gap Examples at Work",
    sim: 0.7,
  });
  assert.equal(r.group, true);
  assert.ok(r.support.includes("title"));
});

test("shouldGroupPair mirrors evaluatePair.group", () => {
  const p = {
    aType: "category", bType: "blog",
    aTitle: "Big Data Training", bTitle: "Big Data Training Companies",
    aUrl: "https://x.com/category/big-data-training", bUrl: "https://x.com/blog/big-data-training-companies",
    sim: 0.7,
  };
  assert.equal(shouldGroupPair(p), evaluatePair(p).group);
});

test("evidence lists every corroborating signal", () => {
  const r = evaluatePair({
    aType: "blog", bType: "blog",
    aTitle: "Skill Matrix Guide", bTitle: "Skill Matrix Handbook",
    aH1: "Skill Matrix", bH1: "The Skill Matrix",
    aDescription: "Build a skill matrix", bDescription: "How to build a skill matrix",
    aUrl: "https://x.com/blog/skill-matrix-guide", bUrl: "https://x.com/blog/skill-matrix-handbook",
    sim: 0.9,
  });
  assert.equal(r.group, true);
  for (const s of ["body", "title", "h1", "description", "url"]) assert.ok(r.support.includes(s as EvidenceSignal), s);
});
