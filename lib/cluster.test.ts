/** npx tsx --test lib/cluster.test.ts */
import { test, assert } from "vitest";
import { connectedComponents, shouldGroupPair, evaluatePair } from "./cluster";

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

// ── shouldGroupPair (type-aware precision rules) ──────────────────────────

test("cross-type pairs never group (bleed, not duplication)", () => {
  assert.equal(shouldGroupPair({ aType: "category", bType: "course", aTitle: "x", bTitle: "x", sim: 0.99 }), false);
  assert.equal(shouldGroupPair({ aType: null, bType: null, aTitle: "x", bTitle: "x", sim: 0.99 }), false);
});

test("distinct courses with template-inflated similarity do NOT group", () => {
  // Express.js vs Node.js: different products, title Jaccard 0.5, body ~0.74-0.90.
  assert.equal(shouldGroupPair({
    aType: "course", bType: "course",
    aTitle: "Express JS Training", bTitle: "Node JS Training",
    sim: 0.90,
  }), false);
});

test("true duplicate courses group at the hard bar", () => {
  assert.equal(shouldGroupPair({
    aType: "course", bType: "course",
    aTitle: "Anything", bTitle: "Entirely Different",
    sim: 0.95,
  }), true);
});

test("re-listed course (same title) groups at the softer bar", () => {
  assert.equal(shouldGroupPair({
    aType: "course", bType: "course",
    aTitle: "Leadership Skills Training", bTitle: "Leadership Skills Training",
    sim: 0.89,
  }), true);
});

test("blogs group at the editorial threshold WITH lexical corroboration", () => {
  const base = {
    aType: "blog", bType: "blog",
    aTitle: "Top Big Data Training Companies", bTitle: "Top Corporate Training Companies",
  };
  assert.equal(shouldGroupPair({ ...base, sim: 0.86 }), true);
  assert.equal(shouldGroupPair({ ...base, sim: 0.84 }), false); // below body floor
});

// ── evaluatePair (multi-signal evidence, 15H) ─────────────────────────────

test("body similarity alone never groups below the self-sufficient bar", () => {
  // /enquiry-form vs /contact-us: 88% template body, zero lexical overlap.
  const r = evaluatePair({
    aType: "static", bType: "static",
    aTitle: "Enquire Now", bTitle: "Contact Us",
    aH1: "Enquiry", bH1: "Reach Our Team",
    aDescription: "Send an enquiry", bDescription: "Get in touch with the team",
    aUrl: "https://x.com/enquiry-form", bUrl: "https://x.com/contact-us",
    sim: 0.88,
  });
  assert.equal(r.group, false);
  assert.deepEqual(r.support, []);
});

test("near-verbatim body (≥ self-sufficient) groups without lexical support", () => {
  const r = evaluatePair({
    aType: "blog", bType: "blog",
    aTitle: "Alpha", bTitle: "Omega",
    sim: 0.94,
  });
  assert.equal(r.group, true);
  assert.ok(r.support.includes("body"));
});

test("same title alone never groups — body floor always applies", () => {
  const r = evaluatePair({
    aType: "blog", bType: "blog",
    aTitle: "Leadership Guide", bTitle: "Leadership Guide",
    sim: 0.6, // well below the editorial floor
  });
  assert.equal(r.group, false);
});

test("plural normalization corroborates 'skill gaps' vs 'skills gap'", () => {
  const r = evaluatePair({
    aType: "blog", bType: "blog",
    aTitle: "How to Identify Skill Gaps", bTitle: "Common Skills Gap Examples",
    sim: 0.85,
  });
  assert.equal(r.group, true);
  assert.ok(r.support.includes("title"));
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
  for (const s of ["body", "title", "h1", "description", "url"]) assert.ok(r.support.includes(s as any), s);
});
