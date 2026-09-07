# Keywords — Agent-native SEO Workspace

`keywords` is a shared SEO operating system where humans and AI agents work on the same SQL-backed project state. Web UI, CLI, HTTP API, MCP, and the scheduled Operator all use the same command layer.

The current product scope intentionally stops before article generation and publishing.

## Completed scope

- SQLite + Drizzle; no Firebase / Firestore
- shared typed command boundary and `runs` audit trail
- project, topic, keyword, cluster, page, source, insight, task, decision, policy, work-session, checkpoint, review-request models
- Google Ads keyword ideas, Search Console, SERP, public-web research
- deterministic opportunity context without one opaque SEO score
- evidence-backed cluster/page planning and cannibalization review
- human-only page approval and policy activation
- Decision → Policy project memory
- bounded Agent Work Loop + Human Review Inbox
- **Operator/Scheduler that deterministically selects the next justified SEO task**
- **historical Search Console query/page snapshots and explicit decline detection**
- **real site URL synchronization from sitemap and Search Console into the same Page model**
- React/Vite Web UI, Hono API, CLI, and MCP server
- external article generation / publishing intentionally out of scope

## Architecture

```text
                         ┌── Search Console history
External research ──────┼── Sitemap / live URLs
                         └── Ads / SERP / Web evidence
                                  │
                                  v
Scheduled Operator ─┐       @keywords/commands ─────> @keywords/db ──> SQLite
Human Web UI ───────┤              ^       │
Human CLI ──────────┼──────────────┘       ├── runs / tasks / decisions
Agent MCP ──────────┘                      ├── pages / metric snapshots
                                           ├── policy_rules
                                           └── work_sessions / review_requests
```

Adapters do not write SQL directly.

Specialized command surfaces:

```text
@keywords/commands/planning
@keywords/commands/policy
@keywords/commands/work
@keywords/commands/review
@keywords/commands/site
@keywords/commands/metrics
@keywords/commands/operator
```

## Run locally

```bash
npm install
cp .env.example .env
npm run db:init
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

Create a project:

```bash
npm run cli -- project create "My SEO Project" --domain example.com
npm run cli -- project list
```

# 1. Operator / Scheduler

The Operator answers one question: **what is the most justified next SEO job right now?**

It does not use a hidden composite SEO score. It returns ordered candidates with explicit reasons. Current priority lenses include:

1. unresolved human review
2. unfinished work session
3. existing agent task
4. material query decline from the latest two GSC snapshots
5. missing/stale sitemap inventory
6. missing/stale GSC history
7. high-demand unclustered keyword

Inspect without mutating:

```bash
npm run cli -- operator inspect <projectId>
```

Create at most one deduplicated shared Agent task from the current top actionable candidate:

```bash
npm run cli -- operator tick <projectId>
```

The Hono API can run this automatically while it is alive:

```env
KEYWORDS_OPERATOR_INTERVAL_MINUTES=60
KEYWORDS_OPERATOR_RUN_ON_START=1
```

`0` disables scheduling. A tick creates a task; it does **not** silently execute an SEO strategy or cross human review boundaries.

HTTP:

```text
GET  /projects/:projectId/operator
POST /projects/:projectId/operator/tick
```

MCP exposes read-only `operator_context`. The scheduler itself uses the same `operator.tick` command as the CLI/API.

# 2. Search Console history

Latest GSC values remain cached on keyword rows for convenient opportunity inspection, while historical observations are stored separately in:

```text
keyword_metric_snapshots
page_metric_snapshots
```

Capture both query-level and page-level data for one period:

```bash
npm run cli -- metrics capture <projectId> 2026-08-01 2026-08-07
npm run cli -- metrics capture <projectId> 2026-08-08 2026-08-14
```

Optional:

```bash
--site <Search Console property>
--search-type web
--row-limit 25000
```

Compare the latest two captured periods:

```bash
npm run cli -- metrics context <projectId>
```

The context deliberately exposes separate signals rather than one score:

- `positionDrops`: average position worsened by at least 3 positions
- `clickDrops`: query clicks fell at least 30% from a period with at least 5 clicks
- `pageClickDrops`: page clicks fell at least 30% from a period with at least 5 clicks

These signals feed `operator.inspect`, so a real decline can become the next shared Agent task.

HTTP:

```text
GET  /projects/:projectId/metrics/context
POST /projects/:projectId/metrics/capture
```

MCP:

```text
metrics_context
metrics_capture
```

# 3. Real site synchronization

Live URLs use the **same `pages` table** as content proposals. This makes existing coverage visible to page planning/cannibalization logic instead of maintaining a second site model.

Live Page fields include:

```text
url
source
last_seen_at
status = published
```

Sync the default `https://<project-domain>/sitemap.xml`:

```bash
npm run cli -- site sync <projectId>
```

Or specify a sitemap/index explicitly:

```bash
npm run cli -- site sync <projectId> --sitemap https://example.com/sitemap_index.xml
```

The sitemap reader:

- supports sitemap indexes
- follows a bounded number of child sitemaps
- limits response size and total URLs
- blocks localhost/private-network targets by default
- updates `last_seen_at`
- links a matching workspace proposal by slug when possible
- reports URLs no longer seen as `stale` instead of destructively deleting them

Search Console page-level metric capture also upserts observed URLs into the same Page model.

HTTP:

```text
GET  /projects/:projectId/site
POST /projects/:projectId/site/sync
```

MCP:

```text
site_list
site_sync
```

# Agent work loop

Substantial Agent work is grouped into an explicit `work_session`:

```text
operator_context
      ↓
work_context
      ↓
work_start
      ↓
policy / task / evidence inspection
      ↓
small audited commands
      ↓
work_checkpoint
   ↙       ↘
blocked   review_request
             ↓
         Human Inbox
             ↓
          continue
             ↓
        work_complete
```

A work session stores objective, completion criteria, max-action budget, baseline project counts, command linkage, checkpoints, status, and final state diff. Checkpoints contain outcomes/blockers/next action, not hidden chain-of-thought.

MCP automatically associates subsequent calls with the active session. External research, `site_sync`, and `metrics_capture` consume the action budget; read-only context calls do not.

# Human Review Inbox

When a specific human decision is required, the Agent creates a `review_request` with a target, question, and explicit resolution options. The work session moves to `awaiting_review`.

Agents can request/list reviews but cannot resolve them through MCP. Human resolution can invoke the underlying page/policy review command and resume the work session when no open requests remain.

# Project policy memory

Human judgments are event-level `decisions`. Durable guidance is a separate `policy_rule`:

```text
Human decisions
      ↓
repeated pattern
      ↓
Agent policy candidate
      ↓
Human Activate / Reject
      ↓
future Agent context
```

Agents can propose rules with exact source Decision IDs, but only a human can activate/reject/retire them.

# Research and opportunities

```bash
npm run cli -- research context <projectId>
npm run cli -- research opportunities <projectId> --limit 25
npm run cli -- research web <projectId> https://example.com/page
npm run cli -- research serp <projectId> "target query" --country jp --language ja
npm run cli -- research ads <projectId> "seed keyword"
```

Opportunity lenses:

- striking distance
- Search Console gaps
- high-demand unclustered queries
- low-competition demand

Search Console's legacy `research gsc` command remains available for raw/ad-hoc dimensions. Use `metrics capture` when historical comparison is required.

# Content planning

```bash
npm run cli -- cluster assign <projectId> <clusterId> --keywords <keywordId1,keywordId2>

npm run cli -- page plan <projectId> "SEO Agent Workspace Guide" \
  --cluster <clusterId> \
  --primary <keywordId> \
  --secondary <keywordId2,keywordId3> \
  --sources <sourceId1,sourceId2> \
  --rationale "One SERP intent; no distinct existing landing page."

npm run cli -- page cannibalization <projectId>
```

Agents stop at proposal creation. Page approval is human-only, and exact target overlap blocks normal approval unless a human explicitly overrides it with a recorded reason.

# Credentials

Credentials are environment-only and are never intentionally persisted to SQLite.

- SERP: `KEYWORDS_SERPER_API_KEY` / `SERPER_API_KEY`
- Google Ads: `GOOGLE_ADS_ACCESS_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`
- Search Console: `GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN`, `GOOGLE_SEARCH_CONSOLE_SITE_URL`
- shared Google OAuth fallback: `GOOGLE_OAUTH_ACCESS_TOKEN`
- scheduler: `KEYWORDS_OPERATOR_INTERVAL_MINUTES`, `KEYWORDS_OPERATOR_RUN_ON_START`

OAuth refresh/token issuance remains outside workspace persistence.

# Verification

GitHub Actions verifies:

- typecheck: domain, db, research, commands, api, cli, mcp, web
- SQLite initialization
- legacy SQLite migration into work/review/live-page/GSC-history schema
- content-planning smoke
- policy-memory smoke
- Agent work-loop smoke
- Human Review smoke
- Operator decline → task smoke
- Web production build

CI cancels superseded runs on the same branch.

# Current autonomy boundary

The SEO OS is considered feature-complete at **Operator/Scheduler + GSC history + real-site synchronization**. Agents may research, synchronize evidence/site state, organize keywords/clusters, create tasks/insights/policy candidates, and propose pages. Human approval remains required where configured.

**Article generation and external publishing are intentionally not implemented in the current scope.**
