# Keywords — Agent-native SEO Workspace

`keywords` is a shared SEO workspace for humans and AI agents. The product is not a fixed article-generation pipeline. The same domain commands are exposed to the web UI, CLI, API, and MCP server, so a human action and an agent tool call operate on the same project state.

## Current scope

- SQL-first storage with SQLite + Drizzle (no Firebase / Firestore)
- Project, topic, keyword, cluster, page, page-target, source, insight, task, decision, and run models
- Shared command layer with audit logging
- External read adapters for Google Ads keyword ideas, Search Console Search Analytics, SERP research, and public web pages
- Normalized latest Search Console query metrics on keyword records
- Deterministic SEO opportunity context for agents/operators
- Evidence-backed page planning with primary/secondary keyword targets
- Cannibalization review for exact target overlap and multiple pages in one cluster
- Bulk keyword-to-cluster assignment
- Human-only page review/approval with conflict blocking and decision logging
- Hono HTTP API
- CLI for human/operator workflows
- MCP server for AI agents
- React workspace UI: content map, keyword backlog, page plans, overlap review, human review controls, tasks, decisions, evidence, and agent activity
- Publishing integrations are intentionally out of scope for now

## Architecture

```text
External research ──> @keywords/research ──┐
                                          v
Human ── Web UI ─┐                    @keywords/commands ──> @keywords/db ──> SQLite
Human ── CLI ────┼─────────────────────────^       │
Agent ── MCP ────┘                                 └──> Run / Decision audit trail
```

`@keywords/research` performs external reads only. `@keywords/commands` remains the mutation boundary and persists normalized research into `sources`, `keywords`, and the audit trail. The stricter content-planning surface is exported as `@keywords/commands/planning` while the original lightweight page commands remain internal compatibility code.

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
  commands/  domain commands + planning commands + audit log
scripts/     runtime smoke tests
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

## Content planning

Assign several validated keywords to a cluster in one audited command:

```bash
npm run cli -- cluster assign <projectId> <clusterId> --keywords <keywordId1,keywordId2>
```

Create an evidence-backed page proposal:

```bash
npm run cli -- page plan <projectId> "SEO Agent Workspace Guide" \
  --cluster <clusterId> \
  --primary <keywordId> \
  --secondary <keywordId2,keywordId3> \
  --sources <sourceId1,sourceId2> \
  --rationale "One SERP intent; no distinct existing landing page."
```

`page plan` stores keyword targets in the relational `page_keywords` table. A primary target represents the core page intent; secondary targets are close variants expected to be satisfied by the same document. Linked research evidence is stored as source IDs rather than copied into the proposal.

Before approving a new page, inspect overlap:

```bash
npm run cli -- page cannibalization <projectId>
```

The check reports:

- `exactTargetConflicts`: two or more non-archived pages explicitly target the same keyword
- `sameClusterConflicts`: two or more non-archived pages belong to the same intent cluster

These are review signals, not proof of SEO cannibalization. SERP intent still determines whether pages should be merged, retargeted, or intentionally kept separate.

Agents stop at proposal creation. There is intentionally no MCP approval tool. Human review is available in the web workspace and CLI:

```bash
npm run cli -- page review <projectId> <pageId> approved
npm run cli -- page review <projectId> <pageId> rejected --reason "Duplicate intent"
npm run cli -- page review <projectId> <pageId> needs_edit --reason "Separate transactional intent first"
```

Normal approval is blocked if another non-archived page explicitly targets the same keyword. A human can override only explicitly and with a recorded reason:

```bash
npm run cli -- page review <projectId> <pageId> approved --override-conflicts --reason "Intentional canonical/variant split"
```

Every review writes a `decision` record. The public HTTP API also routes page state changes through `/projects/:projectId/pages/:pageId/review`; the old direct page-status endpoint is not exposed.

Equivalent MCP planning tools are `cluster_bulk_assign`, `page_plan`, `page_targets`, and `page_cannibalization`. MCP deliberately stops before `page_review`.

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

Agents should follow an observe → opportunity context → research only where needed → overlap check → plan/command → observe loop. Research tools automatically persist useful evidence as `sources`. If the host agent uses its own browser/search capability, `source_record` lets it save that evidence into the same workspace.

Human decisions are stored in `decisions` and every command execution is recorded in `runs`. These records are intended to become the feedback source for project-specific skills and policies.

External publishing remains intentionally unimplemented.
