/**
 * Center-based ("leader") topic clustering for Content Clusters
 * (PROJECTLOG §17D-E - replaces the old body-embedding connected-components
 * approach, which chained different topics into a single 375-page hairball).
 *
 * A cluster = one TOPIC across content types (the category page is the natural
 * pillar; its courses/blogs are spokes). Every member matches the cluster's
 * SEED directly by distinctive-topic-token overlap - never member↔member - so
 * transitive chaining is impossible by construction.
 *
 * Pure + deterministic. Unit-tested in cluster.test.ts against the user's exact
 * acceptance examples (big-data vs sales/data-analytics/blog/courses).
 */
import { THRESHOLDS, type Thresholds } from "@/lib/thresholds";
import {
  buildDfIndex,
  topicKey,
  topicOverlap,
  sharedTopicTerms,
  topicLabel,
  labelFromTerms,
  type DfIndex,
  type SignalInput,
  type TopicKey,
} from "@/lib/signals";
import { matchSeries, type Series } from "@/lib/series";

export interface ClusterPage {
  url: string;
  title: string | null;
  h1?: string | null;
  type: string | null;
  tokenCount?: number | null;
}

export interface ClusterMember {
  url: string;
  title: string | null;
  type: string | null;
  /** Distinctive topic tokens shared with the seed (the "why grouped" tags). */
  sharedTerms: string[];
  /** IDF-weighted topic overlap vs the seed, 0..1 (1 for the seed itself). */
  matchSim: number;
  /** Body cosine vs the seed when the caller supplied it, else null. */
  bodySim: number | null;
  isSeed: boolean;
}

export interface TopicCluster {
  seedUrl: string;
  /** Human-readable topic label, e.g. "big data" (seed's distinctive terms). */
  label: string;
  members: ClusterMember[];
  /** True when this is a programmatic blog SERIES (lib/series.ts) grouped by
   *  slug template, not by topic-token overlap. Series are always
   *  "differentiate" and skip the body floor. */
  isSeries?: boolean;
}

export interface ClusterResult {
  clusters: TopicCluster[];
  /** URLs whose topic is genuinely unique (never reached minSize) - an answer,
   *  not a coverage gap. */
  singletons: string[];
  /** Total pages evaluated (every page is keyed and considered). */
  corpusSize: number;
  /** The DF index built over the corpus - exposed so callers can reuse it. */
  dfIndex: DfIndex;
}

/**
 * Pillar-priority seed ordering: hubs become seeds before their spokes, so a
 * course/blog attaches to its category rather than seeding a rival cluster.
 */
const SEED_RANK: Record<string, number> = {
  category: 0,
  subcategory: 1,
  "excellence-program": 2,
  "managed-training": 3,
  platform: 3,
  consulting: 3,
  location: 3,
  templates: 3,
  course: 4,
  blog: 5,
  static: 6,
};
export function seedRank(type: string | null): number {
  return SEED_RANK[type ?? "static"] ?? 6;
}

/** Hub content types whose clusters are pillar/spoke families. */
export const HUB_TYPES = new Set(["category", "subcategory", "excellence-program"]);

export interface ClusterOpts {
  dfCap?: number;
  overlap?: number;
  bodyFloor?: number;
  bigramWeight?: number;
  minSize?: number;
  /**
   * Body cosine between seed and candidate URLs, when the caller can supply it
   * (the route computes these in one batched query). Return null/undefined when
   * unknown → the body floor is skipped for that pair.
   */
  bodySim?: (seedUrl: string, memberUrl: string) => number | null | undefined;
  /**
   * Programmatic blog series (lib/series.SERIES). When provided, pages matching
   * a series template are pulled OUT of topic clustering and grouped into one
   * cluster per series (overrides topic membership). Omit to disable (pure
   * topic clustering - used by the unit tests).
   */
  series?: Series[];
}

const sigInput = (p: ClusterPage): SignalInput => ({ title: p.title, h1: p.h1, url: p.url });

/**
 * Cluster a whole corpus by topic. Returns clusters (seeds with ≥ minSize
 * members), the unique-topic singletons, and the DF index used.
 */
export function clusterByTopic(
  pages: ClusterPage[],
  opts: ClusterOpts = {},
  t: Thresholds = THRESHOLDS,
): ClusterResult {
  const dfCap = opts.dfCap ?? t.topicDfCap;
  const overlapBar = opts.overlap ?? t.topicOverlap;
  const bodyFloor = opts.bodyFloor ?? t.topicBodyFloor;
  const bigramWeight = opts.bigramWeight ?? 2;
  const minSize = Math.max(2, opts.minSize ?? 2);

  const dfIndex = buildDfIndex(pages.map(sigInput), dfCap);
  const keyOf = new Map<string, TopicKey>();
  for (const p of pages) keyOf.set(p.url, topicKey(sigInput(p), dfIndex));

  // Programmatic blog series are pulled OUT of topic clustering and grouped by
  // their slug template (lib/series.ts) - they fragment under topic overlap.
  const seriesList = opts.series ?? [];
  const seriesOf = new Map<string, Series>();
  if (seriesList.length) {
    for (const p of pages) {
      const s = matchSeries(p.url, seriesList);
      if (s) seriesOf.set(p.url, s);
    }
  }
  const topicPages = seriesOf.size ? pages.filter((p) => !seriesOf.has(p.url)) : pages;

  // Deterministic pillar-priority order (hubs first, then URL tiebreak).
  const ordered = [...topicPages].sort(
    (a, b) => seedRank(a.type) - seedRank(b.type) || a.url.localeCompare(b.url),
  );

  interface Seed {
    page: ClusterPage;
    key: TopicKey;
    members: ClusterMember[];
  }
  const seeds: Seed[] = [];

  for (const p of ordered) {
    const key = keyOf.get(p.url)!;
    let best: { seed: Seed; overlap: number; shared: string[]; body: number | null } | null = null;

    // A page with an empty topic key can only ever seed its own singleton.
    if (key.unigrams.length || key.bigrams.length) {
      for (const s of seeds) {
        const ov = topicOverlap(key, s.key, dfIndex, bigramWeight);
        if (ov < overlapBar) continue;
        const body = opts.bodySim?.(s.page.url, p.url) ?? null;
        if (body != null && body < bodyFloor) continue; // body floor vs seed
        if (!best || ov > best.overlap) {
          best = { seed: s, overlap: ov, shared: sharedTopicTerms(key, s.key), body };
        }
      }
    }

    if (best) {
      best.seed.members.push({
        url: p.url,
        title: p.title,
        type: p.type,
        sharedTerms: best.shared,
        matchSim: Number(best.overlap.toFixed(4)),
        bodySim: best.body == null ? null : Number(best.body.toFixed(4)),
        isSeed: false,
      });
    } else {
      seeds.push({
        page: p,
        key,
        members: [
          {
            url: p.url,
            title: p.title,
            type: p.type,
            sharedTerms: [...key.bigrams, ...key.unigrams].slice(0, 5),
            matchSim: 1,
            bodySim: null,
            isSeed: true,
          },
        ],
      });
    }
  }

  const clusters: TopicCluster[] = [];
  const singletons: string[] = [];
  for (const s of seeds) {
    if (s.members.length >= minSize) {
      clusters.push({
        seedUrl: s.page.url,
        // Label from what MEMBERS share, not the seed's own tokens - so a
        // seed-only token (the country in a "skills in demand in {country}"
        // series) can't dominate ("demand denmark" -> "demand skills").
        label: clusterLabel(s.members) || topicLabel(s.key) || "(untitled topic)",
        members: s.members,
      });
    } else {
      for (const m of s.members) singletons.push(m.url);
    }
  }

  // Series clusters: one per matched series, grouped by slug template. Members
  // belong by construction (matchSim 1, no body floor); the seed is the
  // cleanest-URL member (a series has no topic pillar).
  if (seriesOf.size) {
    const bySeries = new Map<string, ClusterPage[]>();
    for (const p of pages) {
      const s = seriesOf.get(p.url);
      if (s) (bySeries.get(s.name) ?? bySeries.set(s.name, []).get(s.name)!).push(p);
    }
    for (const [name, group] of bySeries) {
      if (group.length < minSize) {
        for (const p of group) singletons.push(p.url);
        continue;
      }
      const tokens = seriesList.find((s) => s.name === name)?.tokens ?? [name];
      const ordered = [...group].sort(
        (a, b) => a.url.length - b.url.length || a.url.localeCompare(b.url),
      );
      const seedUrl = ordered[0].url;
      clusters.push({
        seedUrl,
        label: name,
        isSeries: true,
        members: ordered.map((p) => ({
          url: p.url,
          title: p.title,
          type: p.type,
          sharedTerms: tokens,
          matchSim: 1,
          bodySim: null,
          isSeed: p.url === seedUrl,
        })),
      });
    }
  }

  clusters.sort(
    (a, b) => b.members.length - a.members.length || a.seedUrl.localeCompare(b.seedUrl),
  );

  return { clusters, singletons, corpusSize: pages.length, dfIndex };
}

/**
 * Cluster label from the tokens members SHARE (not the seed's own key). Tally
 * every member's shared-with-seed terms, keep those common to a meaningful
 * share of the cluster, and rank by frequency - so "demand skills" (in all 27
 * country pages) beats "demand denmark" (only the seed). A seed-only token
 * never reaches the frequency floor, so it drops out of the label.
 */
function clusterLabel(members: ClusterMember[]): string {
  const tally = new Map<string, number>();
  for (const m of members) {
    for (const term of m.sharedTerms) tally.set(term, (tally.get(term) ?? 0) + 1);
  }
  const minFreq = Math.max(2, Math.ceil(members.length * 0.3));
  const ranked = [...tally.entries()]
    .filter(([, f]) => f >= minFreq)
    .sort(
      (a, b) =>
        b[1] - a[1] || // most common first
        (b[0].includes(" ") ? 1 : 0) - (a[0].includes(" ") ? 1 : 0) || // bigrams first
        b[0].length - a[0].length,
    )
    .map(([term]) => term);
  return labelFromTerms(ranked);
}
