## Keywords Automation Monorepo

Implements the SEO support system for per-project keyword discovery, clustering, prioritisation, outlining, and internal link suggestions. Core automation lives in `packages/scheduler`, with shared libraries in `packages/core`, Ads/Gemini integrations, API trigger surface, and admin UI specification.

### Structure

- `packages/core` - shared types, normalization, scoring, retry, linking helpers.
- `packages/ads` - Google Ads KeywordPlan idea wrapper.
- `packages/gemini` - Gemini API client for embeddings and outline generation.
- `packages/scheduler` - CLI orchestrating stages A-E, emitting Firestore updates and summaries.
- `apps/api` - Express API exposing manual triggers and category expansion.
- `apps/web` - Next.js admin UI specification (implementation pending).
- `.github/workflows/pipeline.yml` - GitHub Actions schedule/dispatch job using service-account JSON.

### Usage

Install dependencies and build:

```bash
npm install
npm run build
```

Run scheduler for a project:

```bash
npm run scheduler:run -- --project my-blog --manual
```

Environment variables (Secrets in production):

- `GCP_SA_KEY_JSON`, `GEMINI_API_KEY`
- `ADS_DEVELOPER_TOKEN`, `ADS_REFRESH_TOKEN`, `ADS_CLIENT_ID`, `ADS_CLIENT_SECRET`, `ADS_CUSTOMER_ID`
- `GCP_PROJECT_ID`, `FIRESTORE_DB`

All stages honour project-level `halt` flag, deduplicate keywords per theme, maintain version history, and log single-line JSON summaries per run.
