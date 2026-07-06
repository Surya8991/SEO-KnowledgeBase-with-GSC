# Conflict Checker — Step-by-Step Setup Guide

Follow these steps in order. Each step says **what to do**, **where to click**, and **what to paste into `.env`**.

Your `.env` file lives at the repo root next to [`.env.example`](.env.example). If it doesn't exist yet:

```bash
cp .env.example .env
```

For Vercel, paste the same keys into **Project → Settings → Environment Variables** instead.

---

## STEP 0 — Pick a chat provider (REQUIRED, ~1 min)

The app needs at least one chat key to summarize and classify. Cheapest path is **Groq** (free tier, very fast).

1. Open https://console.groq.com/keys → **Create API Key**.
2. Paste into `.env`:
   ```
   GROQ_API_KEY=gsk_...
   AI_CHAT_PROVIDER=groq
   ```

(Skip if you'd rather use Claude — set `ANTHROPIC_API_KEY` and `AI_CHAT_PROVIDER=claude` in STEP 4 instead.)

---

## STEP 1 — Neon Database (REQUIRED, ~3 min)

Without this, nothing gets saved and the Conflict Checker can't compare against existing pages.

1. Open https://console.neon.tech/signup
2. Sign up with Google (use **marketing@edstellar.com**) — free tier is fine.
3. After login, click **"Create a project"**.
   - Project name: `conflict-checker`
   - Postgres version: keep default (17)
   - Region: pick closest to you (Asia Pacific = Singapore/Mumbai)
   - Click **Create**.
4. On the project dashboard you'll see a box titled **"Connection string"**.
   - Make sure **"Pooled connection"** is selected (toggle on the right).
   - Click the **copy** icon.
   - It looks like: `postgresql://neondb_owner:xxx@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
5. Open `.env` and paste it after `DATABASE_URL=`:
   ```
   DATABASE_URL=postgresql://neondb_owner:...
   ```
6. Save the file, then:
   ```bash
   npm run db:setup                  # enables pgvector + creates all tables
   npm run ingest -- --limit=50      # smoke-test: crawl 50 pages first to verify DB + embedder work
   # If that succeeds, run the full crawl:
   npm run ingest                    # crawls ~2,461 URLs (takes 10–30 min on first run)
   ```
   **Do not** run the full `npm run ingest` against the production Neon project on day one. Use a separate branch or a personal Neon project for development.

---

## STEP 2 — Google Search Console OAuth (for the GSC tab, ~5 min)

Only needed if you want the Search Console dashboard. Skip if you only care about conflict checking for now.

1. Open https://console.cloud.google.com/
2. Sign in with the Google account that owns Search Console for edstellar.com.
3. Top bar → click the project dropdown → **"New Project"**.
   - Name: `conflict-checker`
   - Click **Create**, then select it in the dropdown.
4. In the left menu / search bar, go to **"APIs & Services" → "Library"**.
   Direct link: https://console.cloud.google.com/apis/library
5. Search for **"Google Search Console API"** → click it → **Enable**.
6. Go to **"APIs & Services" → "OAuth consent screen"**.
   Direct link: https://console.cloud.google.com/apis/credentials/consent
   - User type: **External** → Create.
   - App name: `Conflict Checker`
   - User support email: marketing@edstellar.com
   - Developer contact: marketing@edstellar.com
   - Click **Save and Continue** through Scopes (skip), Test Users:
     - Add `marketing@edstellar.com` as a test user.
   - Save and Continue → Back to Dashboard.
7. Go to **"APIs & Services" → "Credentials"**.
   Direct link: https://console.cloud.google.com/apis/credentials
   - Click **"+ Create Credentials"** → **"OAuth client ID"**.
   - Application type: **Web application**
   - Name: `Conflict Checker`
   - **Authorized redirect URIs** → Add **both**:
     ```
     http://localhost:3000/api/gsc/callback
     https://edstellar-conflict-checker-knowledg.vercel.app/api/gsc/callback
     ```
   - Click **Create**.
8. A popup shows **Client ID** and **Client Secret**. Copy both.
9. Paste into `.env` (and set the redirect URI to whichever environment you're running):
   ```
   GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/gsc/callback
   GSC_SITE_URL=https://www.edstellar.com/
   ```
10. Save the file. The "Connect Google" button on the Search Console tab will now work.

---

## STEP 3 — Serper (for Competitor Research, ~2 min)

Powers the Competitors tab by running Google searches for a topic. Free tier = 2,500 searches.

1. Open https://serper.dev
2. Click **"Sign up"** → use Google (marketing@edstellar.com).
3. After login, you land on the **Dashboard** — your **API Key** is shown at the top.
4. Click **Copy**.
5. Paste into `.env`:
   ```
   SERPER_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. Save.

---

## STEP 4 — (Optional) Claude for higher-quality summaries

Groq is fast and free; Claude is slower but writes sharper summaries.

1. Open https://console.anthropic.com/
2. Sign up → **Settings → API Keys** → **Create Key**.
3. Copy the key (starts with `sk-ant-`).
4. Paste into `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   AI_CHAT_PROVIDER=claude
   ```

---

## STEP 5 — (Optional) OpenAI embeddings

The codebase has OpenAI adapters wired up but inactive. Switching embeddings to OpenAI requires re-ingesting the whole corpus because the vector dimension changes (384 → 1536).

1. Get key at https://platform.openai.com/api-keys
2. Paste into `.env`:
   ```
   OPENAI_API_KEY=sk-...
   AI_EMBED_PROVIDER=openai
   ```
3. Run the re-embed migration (SQL in [README.md](README.md) → "Switching embeddings"), then `npm run ingest -- --force`.

---

## STEP 6 — Production hardening (Vercel)

Required before exposing the app publicly:

1. `CRON_SECRET` — set a long random string. **Required.** Since the Session 6 audit (S1), every cron route fails **closed** if the bearer header doesn't match — missing secret = 401 = silent cron breakage. Generate with `openssl rand -hex 32`.
2. `AUTH_SECRET` — long random string. Even with `AUTH_ENABLED=false`, this is now used to sign the GSC OAuth state nonce (Session 6 audit S2). Falls back to `GOOGLE_CLIENT_SECRET` in prod if missing, but a dedicated value is safer. `openssl rand -hex 32`.
3. `WEBHOOK_API_KEY` (optional) — gate `POST /api/check`, `POST /api/summarize`, and `POST /api/rewrite-suggestion` for external callers. When set, callers must send `X-API-Key: <value>`. Session 6 audit (S3) closed the previously-open `/api/summarize` and `/api/rewrite-suggestion` routes; if you leave this blank they fall through to per-IP rate-limiting.
4. `APP_BASE_URL` — set to your `https://edstellar-conflict-checker-knowledg.vercel.app` (or custom domain). Used to build absolute URLs in cron jobs and OAuth flows.
5. `GOOGLE_REDIRECT_URI` — switch to the prod URL `https://edstellar-conflict-checker-knowledg.vercel.app/api/gsc/callback` (and add it to the Google OAuth client's allowed redirect URIs).
6. `BRAND_TERMS` — comma-separated brand/keyword terms the checker treats as house terms (default `edstellar,edstellar.com`).
7. `CONFLICT_MIN_SIMILARITY` (optional) — override the 0.50 cosine floor for surfaced matches. Session 6 audit (H11) raised the default from 0.30; lower this if your team finds the new floor too aggressive. Range 0–1.
8. **Apply the schema migration**: from your laptop with the prod `DATABASE_URL`, run `npm run db:setup` once. Session 6 added `drizzle/0005_check_match_enrichment.sql` (additive, idempotent — safe to re-run).

---

## STEP 7 — Lock the dashboard with Google SSO (when ready)

This is opt-in via `AUTH_ENABLED=true`. Leave it off until the OAuth consent screen is published — otherwise teammates outside the test-users list can't sign in.

1. **Google Cloud Console** → APIs & Services → **OAuth consent screen** → click **Publish app**. Move the consent screen from **Testing** to **In production**. Anyone in `@edstellar.com` will then be able to sign in without being added as a test user.
2. Same console → **Credentials** → your existing OAuth client → **Authorized redirect URIs** → add:
   ```
   https://edstellar-conflict-checker-knowledg.vercel.app/api/auth/callback/google
   ```
   (Keep the GSC one alongside it; same client serves both.)
3. Generate a session secret:
   ```bash
   openssl rand -hex 32     # or run the snippet from earlier in this conversation
   ```
4. In Vercel → Settings → Environment Variables, set:
   ```
   AUTH_ENABLED=true
   AUTH_SECRET=<the random string from step 3>
   AUTH_ALLOWED_DOMAINS=edstellar.com   # comma-separated if you want extras
   ```
5. **Redeploy.** Visit any dashboard page — you'll get redirected to `/signin`. Click **Continue with Google**, sign in with an `@edstellar.com` account, you'll bounce back to where you were.

To roll back without redeploying code: set `AUTH_ENABLED=false` (or delete it) → Redeploy. Dashboard is open again.

---

## After Each Step

The dev server **auto-reloads `.env`** — no restart needed. Just save the file.

If you ever need to restart it manually:
- Stop: Ctrl+C in the dev terminal
- Start: `npm run dev`

---

## Quick Priority

| Want to use… | Minimum required |
|---|---|
| Just paste a topic and see a summary | STEP 0 (chat key) |
| Conflict scoring against Edstellar pages | STEPs 0 + 1 |
| Search Console dashboard | STEPs 0 + 1 + 2 |
| Competitor research | STEPs 0 + 1 + 3 |
| Everything | STEPs 0–3 (+ 6 for prod) |

**Start with STEP 0 + STEP 1** — they unlock the headline tool. Add the rest as you need them.
