# Domain Glossary

Terms used by the Conflict Checker and this knowledge base.

| Term | Definition |
|------|------------|
| **Page** | Any ingested URL from Edstellar — blog post, course page, category, or static page. Stored in `pages` with title, extracted text, content type, and embedding. |
| **Corpus** | The full set of ingested pages. Source list: `data/sitemap-urls.csv` (2,479 URLs raw; ~2,461 after the junk-URL filter in [`lib/sitemap.ts`](../lib/sitemap.ts) drops tag-archives, `/sitemap`, file downloads etc.). |
| **Content type** | Classification per page: `blog`, `course`, `category`, `static`, `industry`. Used as a filter and to colour-code matches in the UI. |
| **Candidate** | The new URL or topic being checked. Not yet in the corpus. |
| **Summary** | LLM-generated 2–3 sentence digest of the candidate's content. Drives both the embedding and the LLM judge. |
| **Search synopsis** | A keyword-dense paraphrase of the candidate, used as the actual embed text (cleaner vector signal than raw body). |
| **Primary query** | The 4–8-word SEO query the LLM thinks the candidate targets. Used for SERP / GSC lookups in place of `keywords[0]`. |
| **Embedding** | Dense vector representation. Default: local `bge-small-en-v1.5` (384-dim). Stored in `pages.embedding` as `vector(384)` in Neon + pgvector. |
| **Similarity** | Cosine similarity between candidate and a corpus page, 0..1. Anything below ~0.55 is treated as noise. |
| **Base score** | Similarity stretched into 0..100 (the `[0.55, 0.95]` band maps to `[0, 100]`). |
| **LLM verdict** | The judge's structured output per shortlisted match: `conflictType`, `conflictScore` (0..100), `rationale`, `overlap[]`, `issue`. |
| **Blended score** | `round(0.4 * base + 0.6 * llm)` — vector signal anchors the LLM in case of hallucination. |
| **Conflict type** | `duplicate` ≥80 · `cannibalization` ≥60 · `partial-overlap` ≥35 · `none` <35 · `needs-review` (vector candidate not yet judged by the LLM). |
| **Vector limit** | How many pgvector neighbours to fetch per check. Default 100. |
| **Classify limit** | How many of those the LLM judges in the headline call. Default 15. The rest are scored from similarity alone and tagged `needs-review`. |
| **Check** | A persisted run of the checker — input, summary, top score, and per-match rows in `checks` / `check_matches`. |
| **Catalog conflict** | A precomputed near-duplicate pair across the corpus (no candidate involved). Produced by `npm run catalog-conflicts`. |
| **GSC** | Google Search Console — clicks, impressions, CTR, position. Joined into the UI per page after OAuth connect. |
| **Serper** | The SERP-data provider used for `/competitors` (`SERPER_API_KEY`). |
