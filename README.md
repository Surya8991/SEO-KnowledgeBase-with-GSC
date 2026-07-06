# Edstellar Conflict Checker

Detect content conflicts (duplication / SEO cannibalization) **before** publishing a blog, course, or page — with a 0–100% conflict score, Google Search Console performance data (24h → 12 months), and competitor research.

Built with **Next.js 16** (App Router) + **Neon Postgres / pgvector**.

> **Security note (Session 6 audit, 2026-06-25):** dashboard ships with a permissive CSP, HSTS, frame-ancestors `'none'`, MIME-sniff guard, and Referrer-Policy by default. The full audit + Session 7 changelog lives in [`PROJECTLOG.md`](PROJECTLOG.md) §10.

## How it works

1. Paste a **URL** or a **topic** → an LLM summarizes it and extracts keywords.
2. The summary is embedded and compared to your existing pages via **pgvector** cosine search.
3. The LLM judges each shortlisted page and assigns a **conflict type** (duplicate / cannibalization / partial-overlap) and a calibrated **0–100% score** (blended with the vector similarity).

## Setup

### 1. Install & configure

```bash
npm install
cp .env.example .env   # then fill in values
```

Minimum to run conflict checks: `DATABASE_URL` (Neon) + `GROQ_API_KEY` **or** `ANTHROPIC_API_KEY`.
Embeddings default to a **local** model (`AI_EMBED_PROVIDER=local`, Transformers.js `bge-small-en-v1.5`, 384-dim) — no key needed; the model downloads on first use.

### 2. Database (Neon + pgvector)

Create a free Postgres at [neon.tech](https://neon.tech), copy the **pooled** connection string into `DATABASE_URL`, then:

```bash
npm run db:setup      # creates the pgvector extension + all tables
```

### 3. Ingest the corpus

Crawls the bundled sitemap ([`data/sitemap-urls.csv`](data/sitemap-urls.csv), 2,479 URLs — ~2,461 after junk filtering in [`lib/sitemap.ts`](lib/sitemap.ts) drops tag-archives, `/sitemap`, file downloads etc.), extracts content, and embeds each page.

```bash
npm run ingest -- --limit=50      # quick sample first
npm run ingest                    # full crawl (re-runnable; skips unchanged)
# flags: --only=blog  --force  --concurrency=6
```

### 4. Run

```bash
npm run dev        # http://localhost:3000
```

## Features by page

| Route | What it does |
|---|---|
| `/conflict-checker` | The headline tool — URL/topic → summary → scored matches. |
| `/catalog-conflicts` | Precomputed near-duplicate pairs across the catalogue. Build with `npm run catalog-conflicts`. |
| `/search-console` | GSC clicks/impressions/CTR/position, 24h–12m, with a trend chart. Click **Connect Google** to authorize. |
| `/competitors` | SERP-based competitor research per topic (needs `SERPER_API_KEY`). |
| `/corpus` | Browse/search the ingested pages. |

## AI providers

Selected via env — no code changes to switch:

- `AI_CHAT_PROVIDER` = `groq` (default) · `claude` · `openai`
- `AI_EMBED_PROVIDER` = `local` (default) · `openai`

OpenAI adapters are wired but **inert until `OPENAI_API_KEY` is set**.

> **Switching embeddings to OpenAI later:** `text-embedding-3-small` is 1536-dim, but the corpus column is `vector(384)`. You must widen the column and **re-embed**:
> ```sql
> ALTER TABLE pages DROP COLUMN embedding;
> ALTER TABLE pages ADD COLUMN embedding vector(1536);
> CREATE INDEX pages_embedding_idx ON pages USING hnsw (embedding vector_cosine_ops);
> ```
> Update `EMBED_DIM` in `lib/db/schema.ts` and the `vector(384)` literals in `drizzle/0000_init.sql`, set `AI_EMBED_PROVIDER=openai`, then re-run `npm run ingest -- --force`.

## Google Search Console (OAuth)

1. In [Google Cloud Console](https://console.cloud.google.com): create an **OAuth 2.0 Client (Web)**, enable the **Search Console API**.
2. Add redirect URI `http://localhost:3000/api/gsc/callback` (and `https://edstellar-conflict-checker-knowledg.vercel.app/api/gsc/callback` for prod).
3. Put the client ID/secret and your verified `GSC_SITE_URL` in `.env`.
4. Visit `/search-console` → **Connect Google**.

## Deploy to Vercel

This repo is a single Next.js app at the root — Vercel will auto-detect it.

1. **Import** the repo in Vercel.
2. **Environment variables** — copy every key from [`.env.example`](.env.example) into Vercel → Project → Settings → Environment Variables. At minimum: `DATABASE_URL` + one chat provider key. Set `APP_BASE_URL` to your `https://edstellar-conflict-checker-knowledg.vercel.app` (or custom domain) and `GOOGLE_REDIRECT_URI` to that domain + `/api/gsc/callback`.
3. **Build** — defaults (`next build`) are correct; no overrides needed.
4. **First deploy** — pushes succeed but the DB is empty. After deploy:
   ```bash
   # one-off from your laptop, against the same DATABASE_URL Vercel uses
   npm run db:setup
   npm run ingest
   ```
5. **Crons** — [`vercel.json`](vercel.json) registers three schedules (`/api/cron/reingest`, `/api/cron/audit-links`, `/api/cron/gsc-snapshot`). **`CRON_SECRET` is required** — since the Session 6 audit, every cron route fails **closed** (returns 401) when the bearer header doesn't match. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically once you set the env var.
6. **External webhook (optional)** — `WEBHOOK_API_KEY` gates three LLM-burning endpoints from external callers: `POST /api/check`, `POST /api/summarize`, `POST /api/rewrite-suggestion`. When set, callers must send `X-API-Key: <value>`; when unset, per-IP rate-limiting is the only gate.
7. **Run the schema migration** (one-time, after first deploy): `npm run db:setup` against the prod Neon DB. Idempotent — applies any unapplied `drizzle/*.sql` files; safe to re-run.

### Vercel pre-deploy checklist

The audit below surfaced four things that need attention **before** the first prod deploy. They aren't auto-fixable without `npm install` (see [`AGENTS.md`](AGENTS.md) — Next 16 config must be written against the installed docs):

1. **`next.config.ts` — add `serverExternalPackages`.** The runtime-only deps (`@xenova/transformers`, `jsdom`, `cheerio`, `googleapis`) should NOT be bundled by Next's tracer. After `npm install`, add them to `serverExternalPackages` in `next.config.ts` (key name + exact shape per Next 16 docs in `node_modules/next/dist/docs/`). Without this, the function bundle balloons past Vercel's size limit and the Transformers.js model loader breaks.
2. **`next.config.ts` — `outputFileTracingIncludes` for `data/`.** [`lib/sitemap.ts`](lib/sitemap.ts), [`lib/taxonomy.ts`](lib/taxonomy.ts), and [`lib/gsc-insights.ts`](lib/gsc-insights.ts) all do `readFileSync(join(process.cwd(), "data", …))` at runtime. Next's file tracer won't pick those up (the path is dynamic), so add `data/**/*` to `outputFileTracingIncludes` for the API routes that need them (`/api/check/*`, `/api/cron/reingest`, `/api/cron/gsc-snapshot`, `/api/competitors/*`).
3. **Embedder choice for prod.** The default local embedder downloads `bge-small-en-v1.5` (~30 MB) into `/tmp` on each cold start — fine for the long-lived `/api/cron/reingest` (`maxDuration = 300`), painful for `/api/check` (cold start ≈ 8–15 s the first time after a deploy). For prod, either: (a) set `AI_EMBED_PROVIDER=openai` after running the 384→1536 column-widen + re-ingest (SQL above), or (b) accept the cold-start cost and warm the function with the cron.
4. **Vercel plan limits for crons.** [`vercel.json`](vercel.json) registers **three** crons, two of them **weekly**. Hobby allows max 2 crons and daily cadence only — you need **Pro** for this config. Also: `/api/cron/reingest` walks all ~2,461 sitemap URLs sequentially with an embed call per URL. Even at 300 s, a full re-ingest from cold will timeout. Seed the corpus locally with `npm run ingest` once, then let the cron handle deltas only.

## Repository layout

```
.                              ← Next.js app root (deployed by Vercel)
├── app/                       ← App Router routes (pages + /api/*)
├── lib/                       ← AI providers, conflict pipeline, scoring, DB, etc.
├── scripts/                   ← One-off / cron-target scripts (tsx)
│   ├── ingest.ts              ← crawl + embed sitemap
│   ├── db-setup.ts            ← apply drizzle/*.sql migrations
│   ├── catalog-conflicts.ts   ← precompute near-duplicate pairs across corpus
│   ├── audit-links.ts         ← HEAD-check every URL → pages.http_status
│   ├── backfill-tags.ts       ← retag corpus from taxonomy JSON (no re-embed)
│   ├── cluster.ts             ← k-means topic clustering over embeddings
│   ├── cleanup-junk-pages.ts  ← remove junk rows (tag archives etc.) from `pages`
│   ├── reclassify-home.ts     ← one-off: home page → static content_type
│   ├── verify-corpus.ts       ← post-ingest sanity report (counts + spot-check)
│   ├── extract-taxonomy.py    ← rebuild data/taxonomy/*.json from Hub HTML
│   └── test-embed.ts          ← embed smoke test
├── data/                      ← Sitemap + taxonomy JSON shipped with the repo
├── drizzle/                   ← SQL migrations
├── public/                    ← Static assets
│   └── brand/                 ← Edstellar logo + favicon variants (SVG + PNG)
├── docs/                      ← Domain knowledge base (not built; reference only)
│   ├── repo-overview.md       ← Map of this repo
│   ├── about-edstellar.md
│   ├── glossary.md
│   ├── conflict-types.md
│   ├── conflict-rules.md
│   ├── examples.md
│   └── data-sources.md
├── reference/                 ← Static artifacts (Intelligence Hub HTML)
├── auth.ts                    ← NextAuth v5 config (Google SSO, behind AUTH_ENABLED)
├── proxy.ts                   ← Next 16 proxy gate; redirects unauth'd dashboard routes
├── README.md                  ← (this file)
├── VERCEL_GITHUB_GUIDE.md     ← Plain-English deploy + update walkthrough
├── PRE_PUSH_CHECKLIST.md      ← Run through before every push to main
├── PROJECTLOG.md              ← Session-by-session shipping log
├── SETUP_GUIDE.md             ← Long-form .env setup walkthrough
├── AGENTS.md / CLAUDE.md      ← Notes for AI coding agents working in this repo
├── .env.example               ← Every env var the app reads
├── .nvmrc                     ← Node version pin (22)
└── vercel.json                ← Cron schedules
```
