# Vercel + GitHub — What to Do, Step by Step

A plain-English walkthrough of every action you'll take in **GitHub** and **Vercel** to run this project. Aimed at someone who hasn't deployed a Next.js app before.

> If you just want to make a change and ship it: skip to [§ 5. Day-to-day: updating production](#5-day-to-day-updating-production).

---

## 0. The big picture

| Where | What lives there | What you do there |
|---|---|---|
| **GitHub** (`Layruss98266/Edstellar-Conflict-Checker-KnowledgeBase`) | The source code + history. | Push changes. Code reviews. Roll back if needed. |
| **Vercel** | The running app at `https://edstellar-conflict-checker-knowledg.vercel.app`. Reads your GitHub repo and builds it. | Set environment variables. Watch builds. Add a custom domain. Read function logs. |
| **Neon** (Postgres) | The corpus + check history database. | Nothing day-to-day. You set the connection string once. |
| **Groq / Anthropic / Google / Serper** | External APIs the app calls. | Get keys once, paste into Vercel env vars. |

The flow is: **you push to GitHub `main` → Vercel notices → Vercel builds → if green, the prod URL updates within ~90 seconds.**

---

## 1. GitHub: the repo

### 1.1 Where it is

[`github.com/Layruss98266/Edstellar-Conflict-Checker-KnowledgeBase`](https://github.com/Layruss98266/Edstellar-Conflict-Checker-KnowledgeBase) on the `main` branch.

### 1.2 Clone it once on your laptop

```bash
git clone https://github.com/Layruss98266/Edstellar-Conflict-Checker-KnowledgeBase.git
cd Edstellar-Conflict-Checker-KnowledgeBase
npm install
cp .env.example .env       # fill in real values — see SETUP_GUIDE.md
```

### 1.3 The branch model

- **`main`** is what Vercel deploys to production. Treat it as always-shippable.
- For anything bigger than a typo, use a **feature branch** (`git checkout -b fix/whatever`), open a Pull Request on GitHub, merge to `main` when ready. Vercel will give you a **Preview URL** for every PR.

### 1.4 The rules you can't break

- **Never commit `.env`** — it has secrets. `.gitignore` blocks it, but double-check `git status` before every commit.
- **Never push directly to `main`** if a teammate is reviewing — open a PR.
- **Never run `git push --force` on `main`** — it rewrites history Vercel and others rely on.

---

## 2. Vercel: first-time setup

Do these once.

### 2.1 Sign in and import the repo

1. Go to <https://vercel.com> → **Log In** → choose **Continue with GitHub** (sign in as `Layruss98266`).
2. From the dashboard, click **Add New… → Project**.
3. Find `Edstellar-Conflict-Checker-KnowledgeBase` in the list → **Import**.
4. **Framework Preset**: Vercel will auto-detect **Next.js**. Leave everything else default.
5. **Root Directory**: leave as `.` (we flattened the repo so the app is at the root).
6. **Don't click Deploy yet** — env vars first.

### 2.2 Add environment variables

Still on the import screen, expand **Environment Variables**. Paste each row from [`.env.example`](.env.example). For every variable, tick all three environments: **Production**, **Preview**, **Development**.

**The minimum to actually run** (the app will crash without these):

| Name | Value | Where to get it |
|---|---|---|
| `DATABASE_URL` | The Neon **pooled** connection string | Neon dashboard → your project → "Connection string" → toggle **Pooled** → copy |
| `GROQ_API_KEY` | A Groq API key starting `gsk_…` | <https://console.groq.com/keys> → Create API Key |
| `AI_CHAT_PROVIDER` | `groq` | (literal value) |
| `AI_EMBED_PROVIDER` | `local` | (literal value) |
| `APP_BASE_URL` | `https://edstellar-conflict-checker-knowledg.vercel.app` | Vercel will show this URL after first deploy. Add it now as a placeholder; update it after deploy if the auto-assigned name differs. |
| `CRON_SECRET` | Any long random string, e.g. `openssl rand -hex 32` | **Required for production.** Since the Session 6 audit, cron routes fail CLOSED — every request without a matching `Authorization: Bearer …` header returns 401. Vercel Cron sends the header automatically once this env is set; if it's missing/empty, every cron run 401s. |
| `AUTH_SECRET` | Any long random string, e.g. `openssl rand -hex 32` | **Strongly recommended even when `AUTH_ENABLED=false`.** Session 6 audit (S2) uses this to sign the GSC OAuth state nonce that closes a callback-CSRF hole. Falls back to `GOOGLE_CLIENT_SECRET` in prod if missing — a dedicated value is safer. |
| `BRAND_TERMS` | `edstellar,edstellar.com` | (literal value) |

**Optional, add when you need the feature:**

| Name | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Switching chat provider to Claude | Then also set `AI_CHAT_PROVIDER=claude` |
| `OPENAI_API_KEY` | Switching to OpenAI for chat or embeddings | If embeddings: also do the 384→1536 column-widen migration in `README.md` and re-ingest |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REDIRECT_URI` + `GSC_SITE_URL` | The `/search-console` page | Follow `SETUP_GUIDE.md` STEP 2. The redirect URI for prod is `https://edstellar-conflict-checker-knowledg.vercel.app/api/gsc/callback`. |
| `SERPER_API_KEY` | The `/competitors` page | <https://serper.dev> → Sign up → Dashboard shows the key |
| `WEBHOOK_API_KEY` | Gating LLM-burning endpoints from external callers | Gates three routes: `POST /api/check`, `POST /api/summarize`, `POST /api/rewrite-suggestion`. Callers must send `X-API-Key: <value>`. When unset, per-IP rate-limiting is the only gate. |
| `CONFLICT_MIN_SIMILARITY` | Tuning the conflict floor | Override the default 0.50 cosine floor. Session 6 audit raised this from 0.30 — re-loosen if the team finds it too aggressive. Range 0–1. |
| `AUTH_TRUST_HOST` | Non-Vercel hosts only | `auth.ts` auto-trusts the host inside Vercel via the `VERCEL` env. On any other host, set `=true` to opt in; leave blank/false to reject host-header spoofing. Don't set this on Vercel — it's redundant and easier to misuse than the auto-detect. |

### 2.3 Deploy

1. Click **Deploy**.
2. Wait ~90 seconds. You'll see the build log stream.
3. If it goes green, you get a **Visit** button → opens `https://edstellar-conflict-checker-knowledg.vercel.app`.
4. If it fails, see [§ 6. Troubleshooting](#6-troubleshooting).

### 2.4 First-deploy follow-up — seed the database

The app is up but the database is empty. The Conflict Checker has nothing to compare against until you do this:

```bash
# From your local laptop, using the SAME DATABASE_URL Vercel has:
npm run db:setup        # one-time: enable pgvector, create tables (idempotent)
npm run ingest          # ~20-30 min: crawl + embed every Edstellar URL
```

> **Don't** trigger the initial seed from the Vercel cron — the first run is 30+ minutes wall-clock. Run it locally once. After Session 6, the cron itself uses a 10-way worker pool (`/api/cron/reingest`) so weekly incremental re-ingests fit comfortably under the 300s function limit.

> **Re-run `npm run db:setup` after every push that adds a `drizzle/*.sql` file.** Session 6 added migration `0005_check_match_enrichment.sql`; the loader is idempotent so running it on an already-up-to-date DB is a no-op.

After ingest finishes, open the production URL → paste a URL or topic into `/conflict-checker` → confirm you get scored matches back.

### 2.5 Custom domain (optional)

Vercel → your project → **Settings → Domains** → add `conflict-checker.edstellar.com` (or whatever) → follow the DNS instructions Vercel shows (CNAME to `cname.vercel-dns.com.`). Update `APP_BASE_URL` + `GOOGLE_REDIRECT_URI` to the new domain.

---

## 3. Crons — what they do and what they cost

[`vercel.json`](vercel.json) schedules three jobs:

| Path | Cadence | What it does |
|---|---|---|
| `/api/cron/reingest` | Weekly (Sun 03:00 UTC) | Recrawl any sitemap URL whose `lastmod` changed; re-embed. |
| `/api/cron/audit-links` | Weekly (Sun 04:00 UTC) | HEAD-check every URL; write status to `pages.http_status`. |
| `/api/cron/gsc-snapshot` | Daily (05:30 UTC) | Snapshot yesterday's GSC totals into `gsc_daily_totals`. |

### Plan limits

- **Hobby (free)** allows **max 2 cron jobs** and **daily-or-longer cadence only** with **60s function timeout**. The current config has 3 crons → **Hobby will reject one of them.**
- **Pro ($20/mo)** removes those caps. You need Pro for this config to run as-is.

If you want to stay on Hobby, edit `vercel.json` to drop one of the weekly crons (e.g. remove `/api/cron/audit-links` and run it manually with `npm run audit:links` when you need it).

---

## 4. Updating prod (day-to-day)

For any change — copy fix, bug fix, new feature:

```bash
# 1. Make sure your local main is up to date
git checkout main
git pull

# 2. Branch off
git checkout -b fix/short-description

# 3. Edit files. Test locally:
npm run dev                    # http://localhost:3000

# 4. Commit and push the branch
git add -A
git commit -m "fix: what changed and why"
git push -u origin fix/short-description
```

Then on GitHub:

1. The push prompts you to **Open Pull Request** — click it.
2. Vercel will comment with a **Preview URL** (`https://<branch-name>-<hash>.vercel.app`) — click it to test the change live.
3. When you're happy → **Squash and merge** → delete the branch.
4. Vercel auto-deploys `main` → prod updates in ~90s.

### Rolling back a bad deploy

Vercel → project → **Deployments** → find the last good one → ⋯ menu → **Promote to Production**. Instant.

---

## 5. Day-to-day: updating production

The shortest path for a routine change (you've already done all of the above once):

```bash
git checkout main && git pull
git checkout -b fix/short-thing
# …edit…
git add -A && git commit -m "fix: short thing"
git push -u origin fix/short-thing
# open PR on github.com → check Preview URL → merge → done
```

For a one-line fix you don't want to PR: yes, you can `git checkout main && git commit && git push` directly. Vercel will deploy. Just don't make a habit of it on shared branches.

---

## 6. Troubleshooting

### Build fails: `Failed to type check`

A TypeScript error somewhere. Reproduce locally:

```bash
npx tsc --noEmit
```

Fix the listed files, push, Vercel rebuilds automatically.

### Build fails: `Module not found`

You forgot to run `npm install` after pulling, OR a dependency was added without committing `package-lock.json`. Run `npm install` locally, commit any lockfile change, push.

### `/conflict-checker` returns empty matches

The database is empty or stale. Run `npm run ingest` from your laptop (with the prod `DATABASE_URL` in your local `.env`).

### `/conflict-checker` returns "checker error"

Check Vercel → project → **Logs** → look at recent invocations of `/api/check`. Usual culprits:

- `DATABASE_URL` missing or wrong → fix in Vercel env vars and redeploy.
- `GROQ_API_KEY` invalid → regenerate at <https://console.groq.com/keys>.
- The local embedder timed out on cold start → expected first time after a deploy; the second request is fast.

### `/search-console` says "Connect Google" forever

The redirect URI in Google Cloud Console doesn't include your Vercel URL. In Google Cloud → **Credentials → your OAuth client → Authorized redirect URIs**, add `https://edstellar-conflict-checker-knowledg.vercel.app/api/gsc/callback`, save, retry.

### Cron job didn't run

Vercel → project → **Cron Jobs** tab shows scheduled runs + invocation logs. If you see `401 Unauthorized`, your `CRON_SECRET` was changed but the cron job's stored secret wasn't — redeploy and Vercel re-syncs.

### The function timed out

`maxDuration` is already maxed for our crons (300s for ingest, 120s for GSC snapshot). If `/api/cron/reingest` still times out it means too many URLs changed since the last run — re-seed locally with `npm run ingest -- --force` to catch up.

---

## 7. Security hygiene

- **Rotate secrets quarterly** or any time one might have leaked (Slack DM, screen-share, accidental commit).
- **If a secret leaks**: in Vercel → **Settings → Environment Variables**, update the value, then redeploy (Deployments tab → ⋯ → Redeploy). Rotate at the source (Neon → Reset password, Groq → revoke key & make new one, Google → regenerate client secret).
- **Never commit `.env`** — `.gitignore` blocks it but `git status` is the safety net.
- **GitHub secret scanning** is on by default. If you push a secret by accident, GitHub will email you and revoke certain known-format keys (Groq, OpenAI, Anthropic do this). Still rotate immediately.

---

## 8. Useful Vercel + GitHub UI corners

| What you want | Where to click |
|---|---|
| See the latest deploy's logs | Vercel → project → **Deployments** → click the top one → **Logs** |
| See runtime function errors | Vercel → project → **Logs** (live tail) |
| Re-trigger a build without code change | Vercel → project → **Deployments** → ⋯ on latest → **Redeploy** |
| Change an env var | Vercel → project → **Settings → Environment Variables** → edit → **Redeploy** to pick it up |
| Run a cron manually now | Vercel → project → **Cron Jobs** tab → ⋯ on the row → **Run now** |
| See who pushed what | GitHub → repo → **Commits** tab |
| Find a file fast in GitHub | Press `t` while on the repo page |
| See PR comments inline | GitHub → PR → **Files changed** tab |

---

## 9. When to ask for help

- Build failed and the log message doesn't make obvious sense → screenshot the error + paste into a chat.
- A feature works locally but breaks in prod → almost always an env var is missing in Vercel. Check **Settings → Environment Variables**.
- A scheduled cron silently stopped → check Vercel **Cron Jobs** tab + the function's recent logs.
- You're about to do `git push --force` to `main` → don't. Ask.

---

**Cheat sheet of the four URLs to bookmark:**

- Repo: <https://github.com/Layruss98266/Edstellar-Conflict-Checker-KnowledgeBase>
- Vercel project: `https://vercel.com/<your-team>/edstellar-conflict-checker-knowledg`
- Neon project: <https://console.neon.tech>
- Production app: `https://edstellar-conflict-checker-knowledg.vercel.app`
