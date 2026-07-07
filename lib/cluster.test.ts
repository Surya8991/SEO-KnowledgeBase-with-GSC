/** npx tsx --test lib/cluster.test.ts */
import { test, assert } from "vitest";
import { clusterByTopic, seedRank, type ClusterPage } from "./cluster";
import { buildDfIndex, isDistinctive } from "./signals";

/**
 * A realistic-shape corpus: ~200 filler category pages, each on a UNIQUE coined
 * topic, all sharing the template word "training". This reproduces the live-DB
 * ratios where the template word is ~100% of pages (filtered) while a topic
 * word like "big" (0.6%) or "data" (3.8%) stays under the 5% DF cap
 * (distinctive). A small corpus would push the 4–5 big-data occurrences over
 * 5% - the cap is a *ratio*, so the corpus must be corpus-sized.
 */
function fillerPages(n = 200): ClusterPage[] {
  return Array.from({ length: n }, (_, i) => {
    const topic = `subjectterm${i}`; // unique token per page → each ~0.5% DF
    return {
      url: `https://x.com/category/${topic}-training`,
      title: `Subjectterm${i} Training`,
      type: "category",
    };
  });
}

const bigDataCat: ClusterPage = {
  url: "https://x.com/category/big-data-training",
  title: "Big Data Training",
  type: "category",
};
const salesCat: ClusterPage = {
  url: "https://x.com/category/sales-training",
  title: "Sales Training",
  type: "category",
};
const dataAnalyticsCat: ClusterPage = {
  url: "https://x.com/category/data-analytics-training",
  title: "Data Analytics Training",
  type: "category",
};
const bigDataBlog: ClusterPage = {
  url: "https://x.com/blog/big-data-training-companies",
  title: "Top Big Data Training Companies",
  type: "blog",
};
const bigDataCourse1: ClusterPage = {
  url: "https://x.com/course/google-big-data-training",
  title: "Google Big Data Training",
  type: "course",
};
const bigDataCourse2: ClusterPage = {
  url: "https://x.com/course/informatica-big-data-training",
  title: "Informatica Big Data Training",
  type: "course",
};

const CORPUS: ClusterPage[] = [
  bigDataCat, salesCat, dataAnalyticsCat, bigDataBlog, bigDataCourse1, bigDataCourse2,
  ...fillerPages(),
];

function clusterOf(url: string, res: ReturnType<typeof clusterByTopic>) {
  return res.clusters.find((c) => c.members.some((m) => m.url === url));
}

// ── DF template-vocabulary learning ───────────────────────────────────────

test("DF cap auto-learns template vs topic vocabulary", () => {
  const idx = buildDfIndex(
    CORPUS.map((p) => ({ title: p.title, url: p.url })),
    0.05,
  );
  // "training" is in every page → template noise → not distinctive.
  assert.equal(isDistinctive("training", idx), false);
  // "big" / "sales" are rare → topic tokens → distinctive.
  assert.equal(isDistinctive("big", idx), true);
  assert.equal(isDistinctive("sales", idx), true);
});

// ── The user's exact acceptance examples ──────────────────────────────────

test("big-data category and sales category are in DIFFERENT clusters", () => {
  const res = clusterByTopic(CORPUS);
  const bd = clusterOf(bigDataCat.url, res);
  const sales = clusterOf(salesCat.url, res);
  // Never co-clustered (the mega-cluster bug).
  if (bd && sales) assert.notEqual(bd.seedUrl, sales.seedUrl);
  assert.ok(!bd?.members.some((m) => m.url === salesCat.url));
});

test("big-data category and data-analytics category are in DIFFERENT clusters", () => {
  const res = clusterByTopic(CORPUS);
  const bd = clusterOf(bigDataCat.url, res);
  assert.ok(!bd?.members.some((m) => m.url === dataAnalyticsCat.url));
});

test("big-data category and big-data blog are in the SAME cluster", () => {
  const res = clusterByTopic(CORPUS);
  const bd = clusterOf(bigDataCat.url, res);
  assert.ok(bd, "big-data forms a cluster");
  assert.ok(bd!.members.some((m) => m.url === bigDataBlog.url), "blog is a member");
});

test("big-data category and its courses are in the SAME cluster (cross-type)", () => {
  const res = clusterByTopic(CORPUS);
  const bd = clusterOf(bigDataCat.url, res);
  assert.ok(bd!.members.some((m) => m.url === bigDataCourse1.url));
  assert.ok(bd!.members.some((m) => m.url === bigDataCourse2.url));
  // The seed is the category (the pillar), not a course/blog.
  assert.equal(bd!.seedUrl, bigDataCat.url);
});

test("cluster label and member evidence surface the shared topic tokens", () => {
  const res = clusterByTopic(CORPUS);
  const bd = clusterOf(bigDataCat.url, res)!;
  assert.match(bd.label, /big|data/);
  const blog = bd.members.find((m) => m.url === bigDataBlog.url)!;
  assert.ok(blog.sharedTerms.some((t) => /big|data/.test(t)));
  assert.ok(blog.matchSim >= 0.16);
});

// ── Body floor demotes a topic match with no body overlap ─────────────────

test("body floor demotes a same-topic member with near-zero body cosine", () => {
  const res = clusterByTopic(CORPUS, {
    // big-data blog shares the topic but pretend its body is unrelated.
    bodySim: (seed, member) =>
      member === bigDataBlog.url ? 0.1 : 0.95,
  });
  const bd = clusterOf(bigDataCat.url, res);
  assert.ok(!bd?.members.some((m) => m.url === bigDataBlog.url), "blog demoted by body floor");
  assert.ok(res.singletons.includes(bigDataBlog.url));
});

// ── Coverage + no mega-cluster ────────────────────────────────────────────

test("every page is accounted for (clustered + singletons = corpus)", () => {
  const res = clusterByTopic(CORPUS);
  const clustered = new Set(res.clusters.flatMap((c) => c.members.map((m) => m.url)));
  const total = clustered.size + res.singletons.length;
  assert.equal(total, CORPUS.length);
  assert.equal(res.corpusSize, CORPUS.length);
});

test("no mega-cluster: largest cluster stays a single coherent topic", () => {
  const res = clusterByTopic(CORPUS);
  const largest = res.clusters[0];
  // The only real family here is big-data (cat + blog + 2 courses = 4).
  assert.ok(largest.members.length <= 5);
  assert.ok(!largest.members.some((m) => m.url === salesCat.url && largest.seedUrl === bigDataCat.url));
});

// ── seedRank ordering (pillars before spokes) ─────────────────────────────

test("seedRank puts hubs before courses and blogs", () => {
  assert.ok(seedRank("category") < seedRank("course"));
  assert.ok(seedRank("course") < seedRank("blog"));
  assert.ok(seedRank("blog") < seedRank("static"));
  assert.equal(seedRank(null), seedRank("static"));
});
