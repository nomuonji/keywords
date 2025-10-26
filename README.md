# Keywords Automation Monorepo

This repository hosts a monorepo that automates keyword research, clustering, outline drafting, and internal link suggestions for content teams. Firestore is used as the system of record, while a scheduler CLI, Express API, and React-based admin UI orchestrate the workflows.

## Repository Layout

```
apps/
  api/     Express API used for manual triggers and node creation
  web/     Admin UI (React + Vite)
packages/
  core/        Shared types, scoring helpers, normalization utilities
  ads/         Keyword volume client (calls the external API)
  gemini/      Gemini integration for embeddings and outline generation
  scheduler/   Orchestrates pipeline stages A?E
scripts/
  test-google-ads.js  Smoke test for the keyword volume API
```

## Pipeline Stages (A �� E)
1. **Keyword Discovery** ? gathers keyword ideas for Firestore `nodes`, normalizes them, stores in `keywords`
2. **Clustering** ? groups new keywords via Gemini embeddings and lightweight clustering, writes to `groups`
3. **SEO Scoring** ? calculates `priorityScore` using volume, competition, intent alignment, and novelty
4. **Outline Drafting** ? generates titles/H2/H3/FAQ with Gemini for top-priority groups
5. **Internal Link Suggestions** ? computes hierarchy / hub / sibling link candidates and stores them in `links`

Every run writes a summary document to `jobs` and keeps data isolated per project.

## Quick Start

```bash
npm install

# Start the API server (listens on port 3001)
npm run dev --workspace apps/api

# Start the admin UI (Vite dev server)
npm run dev --workspace @keywords/web
```

Additional commands:
- `npm run scheduler:run -- --project <projectId> --manual` ? execute pipeline A?E from the CLI
- `npm run test:ads` ? hit the external keyword-volume API for a quick sanity check

## Environment Variables

**Server / Scheduler (`.env`, GitHub Actions, etc.)**
- `GCP_SA_KEY_JSON`, `GEMINI_API_KEY`
- `ADS_DEVELOPER_TOKEN`, `ADS_REFRESH_TOKEN`, `ADS_CLIENT_ID`, `ADS_CLIENT_SECRET`, `ADS_CUSTOMER_ID`, `ADS_LOGIN_CUSTOMER_ID`
- `KEYWORD_VOLUME_API_URL` (provided external endpoint)
- `GCP_PROJECT_ID`, `FIRESTORE_DB`

**Admin UI (`apps/web/.env`)**
- `VITE_FIREBASE_*` ? Firebase client settings
- `VITE_API_BASE_URL` ? URL of the Express API (default: `http://localhost:3001`)

## Admin UI Highlights
- Create / edit projects and themes, trigger the pipeline, and see job history
- Manage seed nodes per theme (node list + add modal)
- Inspect clusters with generated outlines, keyword metrics, and internal link hierarchy

## Notes
- Firestore data is fully isolated per project
- The admin UI triggers `packages/scheduler` stages (A?E) via the API
- Never print external API credentials to logs?use environment variables or secret managers

## Deployment
- `vercel.json` rewrites `/api/*` to the serverless entrypoint in `api/index.js`, which simply re-exports the compiled Express app from `apps/api/dist/app.js`.
- Vercel installs dependencies via `npx -y npm@10 ci --workspaces --include-workspace-root || npx -y npm@10 install --workspaces --include-workspace-root` to match the monorepo setup.
- The build step runs `tsc -b tsconfig.build.json && npm run build --workspace=@keywords/web`, which emits the Express API bundle plus the static admin UI.
- Static assets are emitted to `apps/web/dist`, and `vercel.json` sets `outputDirectory` accordingly so the frontend deploys alongside the `/api` serverless functions.
- Expose the required environment variables (Firebase service account, Gemini keys, etc.) in the Vercel project so the API can connect to Firestore and external services.