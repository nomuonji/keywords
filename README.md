# Keywords — Agent-native SEO Workspace

`keywords` is a shared SEO workspace for humans and AI agents. The product is not a fixed article-generation pipeline. The same domain commands are exposed to the web UI, CLI, API, and MCP server, so a human action and an agent tool call operate on the same project state.

## Current scope

- SQL-first storage with SQLite + Drizzle (no Firebase / Firestore)
- Project, topic, keyword, cluster, page, source, insight, task, decision, and run models
- Shared command layer with audit logging
- External read adapters for Google Ads keyword ideas, Search Console Search Analytics, SERP research, and public web pages
- Normalized latest Search Console query metrics on keyword records
- Deterministic SEO opportunity context for agents/operators
- Hono HTTP API
- CLI for human/operator workflows
- MCP server for AI agents
- React workspace UI: content map, keyword backlog, tasks, decisions, and agent activity
- Publishing integrations are intentionally out of scope for now

## Architecture

```text
External research ──> @keywords/research ──┐
                                          v
Human ── Web UI ─┐                    @keywords/commands ──> @keywords/db ──> SQLite
Human ── CLI ────┼─────────────────────────^       │
Agent ── MCP ────┘                                 └──> Run / Decision audit trail
```

`@keywords/research` performs external reads only. `@keywords/commands` remains the mutation boundary and persists normalized research into `sources`, `keywords`, and the audit trail.

## Repository layout

```text
apps/
  api/       Hono HTTP API
  cli/       operator CLI
  mcp/       MCP server for agents
  web/       React/Vite workspace UI
packages/
  domain/    shared domain types
  db/        Drizzle schema + SQLite bootstrap
  research/  external research adapters (read-only)
  commands/  domain command handlers + persistence + audit log
skills/      agent-facing operating knowledge
```

## Run locally

```bash
npm install
cp .env.example .env
npm run db:init
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

Create a project from the CLI:

```bash
npm run cli -- project create "My SEO Project" --domain example.com
npm run cli -- project list
```

Inspect the compact research context:

```bash
npm run cli -- research context <projectId>
```

Inspect normalized SEO opportunities:

```bash
npm run cli -- research opportunities <projectId> --limit 25
```

The opportunity context deliberately avoids one opaque SEO score and exposes four lenses:

- `strikingDistance`: Search Console average position 4–20, ranked by impressions
- `searchConsoleGaps`: average position >20 with impressions
- `highDemandUnclustered`: Google Ads demand but no cluster assignment
- `lowCompetitionDemand`: competition <=0.4, ranked by demand × (1 − competition)

The same data is available over HTTP:

```text
GET /projects/:projectId/research/opportunities?limit=25
```

and through MCP as `opportunity_context`.

Fetch and persist a public page:

```bash
npm run cli -- research web <projectId> https://example.com/page
```

Run SERP research after setting `KEYWORDS_SERPER_API_KEY`:

```bash
npm run cli -- research serp <projectId> "target query" --country jp --language ja
```

Generate Google Ads keyword ideas after configuring the Ads environment variables:

```bash
npm run cli -- research ads <projectId> "seed keyword" --language-id <criterionId> --geo <geoTargetId>
```

Query Search Console after configuring its access token and property:

```bash
npm run cli -- research gsc <projectId> 2026-08-01 2026-08-31 --dimensions query
```

When `query` is present in the dimensions and import is enabled, the latest clicks, impressions, CTR, and average position are normalized onto the corresponding keyword. These values represent the latest imported observation, not a historical time series. The original research response remains persisted in `sources` as evidence.

Run the MCP server:

```bash
npm run mcp
```

## Research credentials

Credentials are environment-only and are never intentionally persisted to SQLite.

- SERP: `KEYWORDS_SERPER_API_KEY` (or `SERPER_API_KEY`)
- Google Ads: `GOOGLE_ADS_ACCESS_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`; optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION`, language/geo defaults
- Search Console: `GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN`, `GOOGLE_SEARCH_CONSOLE_SITE_URL`
- `GOOGLE_OAUTH_ACCESS_TOKEN` can be used as a shared access-token fallback for Ads/Search Console

OAuth refresh/token issuance is deliberately kept outside workspace persistence. A later credential broker can supply short-lived tokens without changing the research or command APIs.

## Agent model

Agents should follow an observe → opportunity context → research only where needed → decide → command → observe loop. Research tools automatically persist useful evidence as `sources`. If the host agent uses its own browser/search capability, `source_record` lets it save that evidence into the same workspace.

Human decisions are stored in `decisions` and every command execution is recorded in `runs`. These records are intended to become the feedback source for project-specific skills and policies.

External publishing remains intentionally unimplemented.
