/** npx tsx --test lib/signals.test.ts */
import { test, assert } from "vitest";
import {
  tokenize, jaccard, slugTokens, slugOverlap, signalScores, buildDfIndex,
  topicKey, topicLabel, labelFromTerms,
} from "./signals";

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

test("signalScores with a DF index denoises template-only title/slug matches (2c)", () => {
  // Corpus where "training"/"courses" are template noise (in every page) but
  // topic words are rare. Big enough that a topic word stays under the 5% cap.
  const corpus = Array.from({ length: 200 }, (_, i) => ({
    title: `Subjectterm${i} Training Courses`,
    url: `https://x.com/category/subjectterm${i}-training`,
  }));
  const df = buildDfIndex(corpus, 0.05);

  const a = { title: "Big Data Training Courses", url: "https://x.com/category/big-data-training" };
  const b = { title: "Sales Training Courses", url: "https://x.com/category/sales-training" };

  // Without the DF index the shared template words inflate the lexical signals.
  const raw = signalScores(a, b, 0.9);
  // With it, the template words drop out → different topics no longer "match".
  const denoised = signalScores(a, b, 0.9, df);
  assert.ok(denoised.title < raw.title, "template title match is denoised");
  assert.equal(denoised.title, 0, "big-data vs sales share no distinctive title token");
  assert.ok(denoised.slug < raw.slug, "template slug match is denoised");

  // A genuine shared topic token survives the filter.
  const c = { title: "Big Data Training Courses", url: "https://x.com/blog/big-data-companies" };
  assert.ok(signalScores(a, c, 0.9, df).title > 0, "shared topic token 'big data' survives");
});

test("topicKey drops bigrams containing a template word (§17K label fix)", () => {
  // "corporate" is template (every page); "chemical"/"safety" are topic words.
  const corpus = [
    { title: "Corporate Chemical Safety Training", url: "https://x.com/course/chemical-safety-training" },
    ...Array.from({ length: 200 }, (_, i) => ({
      title: `Corporate Subjectterm${i} Training`,
      url: `https://x.com/category/subjectterm${i}-training`,
    })),
  ];
  const df = buildDfIndex(corpus, 0.05);
  const key = topicKey(corpus[0], df);
  // Only the both-words-distinctive bigram survives - no "corporate chemical"
  // or "safety corporate" leaking the template word into the label.
  assert.deepEqual(key.bigrams, ["chemical safety"]);
  assert.ok(!key.bigrams.some((b) => b.includes("corporate")));
  // Label reads as one clean topic, not three.
  assert.equal(topicLabel(key), "chemical safety");
});

test("topicLabel drops listicle filler/numerals and dedupes overlaps", () => {
  // Mimics "11 Most In-Demand Skills in Denmark" - the label used to read
  // "top 11 · 11 demand · demand denmark".
  const key = {
    unigrams: ["11", "most", "demand", "skills", "denmark"],
    bigrams: ["11 most", "most demand", "demand skills", "skills denmark"],
  };
  const label = topicLabel(key);
  assert.ok(!/\d/.test(label), "no numerals in label");
  assert.ok(!/\b(top|most|best)\b/.test(label), "no listicle filler");
  // Overlapping bigrams collapse - "demand skills" and "skills denmark" don't
  // both appear verbatim once their shared words are used.
  assert.ok(label.includes("demand") && label.includes("denmark"));
});

test("labelFromTerms keeps given order, drops filler, dedupes covered terms (§17M)", () => {
  // Given a frequency-ranked list, the leading shared bigram wins and its
  // constituent unigrams are deduped out; filler terms are dropped. (The
  // seed-only country is excluded upstream by clusterLabel's frequency floor,
  // so it never reaches here.)
  const label = labelFromTerms(["demand skills", "demand", "skills", "top demand"]);
  assert.equal(label, "demand skills");
  assert.ok(!/\btop\b/.test(label), "filler dropped");
});
