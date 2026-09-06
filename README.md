# Keywords — Agent-native SEO Workspace

`keywords` is a shared SEO workspace where humans and AI agents operate on the same SQL-backed project state. It is not a fixed keyword → article pipeline: Web UI, CLI, HTTP API, and MCP all use the same command layer.

## Current scope

- SQLite + Drizzle; no Firebase / Firestore
- Project, topic, keyword, cluster, page, page-target, source, insight, task, decision, policy-rule, work-session, checkpoint, and run models
- Google Ads keyword ideas, Search Console Search Analytics, SERP research, and public-web evidence adapters
- Normalized Search Console and Google Ads signals
- Compact deterministic opportunity context
- Evidence-backed page planning with primary/secondary targets
- Cannibalization review and human-only page approval
- Decision-backed project policy memory
- Bounded, auditable AI-agent work sessions
- React/Vite Web UI, Hono API, CLI, and MCP server
- External publishing intentionally not implemented yet

## Architecture

```text
External research ──> @keywords/research ──┐
                                          v
Human ── Web UI ─┐                    @keywords/commands ──> @keywords/db ──> SQLite
Human ── CLI ────┼─────────────────────────^       │
Agent ── MCP ────┘                                 ├──> runs / decisions
                                                    ├──> policy_rules
                                                    └──> work_sessions / checkpoints
```

`@keywords/research` performs external reads only. `@keywords/commands` is the mutation boundary. Specialized command surfaces are exported as:

- `@keywords/commands/planning`
- `@keywords/commands/policy`
- `@keywords/commands/work`

Adapters do not write SQL directly.

## Repository layout

```text
apps/
  api/       Hono HTTP API
  cli/       operator CLI
  mcp/       MCP server for AI agents
  web/       React/Vite workspace UI
packages/
  domain/    shared domain types
  db/        Drizzle schema + SQLite bootstrap
  research/  external research adapters
  commands/  domain, planning, policy, and work-loop commands
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

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

Create a project:

```bash
npm run cli -- project create "My SEO Project" --domain example.com
npm run cli -- project list
```

## Agent work loop

Substantial agent work is grouped into an explicit `work_session`.

```text
work_context
    ↓
work_start
    ↓
inspect policy / tasks / opportunities
    ↓
research only where needed
    ↓
structured commands
    ↓
work_checkpoint
   ↙   ↓      ↘
working blocked awaiting_review
   ↓             ↓
continue       human action
   └──────┬──────┘
          ↓
      work_resume
          ↓
     work_complete
          ↓
baseline → final state diff
```

A work session stores:

- bounded `objective`
- explicit `completionCriteria`
- `maxActions` budget
- baseline project counts
- command linkage through `runs.work_session_id`
- concise checkpoints
- status: `running`, `awaiting_review`, `blocked`, `completed`, or `cancelled`
- final project-state diff

Checkpoint text is for externally useful outcomes, blockers, and next actions. It is **not** a chain-of-thought or hidden scratchpad.

MCP tools:

```text
work_context
work_start
work_resume
work_checkpoint
work_complete
work_cancel
work_list
```

`work_context` is the preferred bootstrap call. It returns a compact view containing:

- active project policies
- candidate policies
- prioritized agent tasks
- human review queue
- open insights
- top normalized opportunities
- current work session + remaining action budget
- a deterministic `next` focus hint

Example CLI flow:

```bash
npm run cli -- work context <projectId>
npm run cli -- work start <projectId> --max-actions 12
npm run cli -- work checkpoint <projectId> <sessionId> awaiting_review \
  --summary "Created an evidence-backed page plan; human approval is required." \
  --next "Review page proposal"
npm run cli -- work resume <projectId> <sessionId>
npm run cli -- work complete <projectId> <sessionId> \
  --summary "Completed the selected SEO task and left one approved plan."
```

The MCP server automatically associates subsequent tool calls with the active work session after `work_start`/`work_resume`. When a session is `awaiting_review` or `blocked`, MCP blocks further writes and external research until the session is resumed. When the local action budget is exhausted, the agent must checkpoint or complete instead of expanding scope.

The Web UI polls recent work sessions and shows objective, status, command usage, remaining actions, latest checkpoint, and next action.

The HTTP API can also link ordinary commands to a session by sending:

```text
x-keywords-work-session-id: <sessionId>
```

## Project policy memory

The feedback loop is explicit rather than hidden model fine-tuning:

```text
Human review / judgment
        ↓
     decision
        ↓
policy_context groups repeated patterns
        ↓
Agent proposes candidate with exact decision IDs
        ↓
Human Activate / Reject
        ↓
active policy returned to future agents
        ↓
Human may later Retire with a reason
```

Read policy context:

```bash
npm run cli -- policy context <projectId>
```

MCP exposes `policy_context` and `policy_propose`, but deliberately does **not** expose policy activation/rejection/retirement.

Human review:

```bash
npm run cli -- policy review <projectId> <policyId> active
npm run cli -- policy review <projectId> <policyId> rejected --reason "Too broad"
npm run cli -- policy retire <projectId> <policyId> --reason "Strategy changed"
```

## Research and opportunities

Compact research state:

```bash
npm run cli -- research context <projectId>
```

Normalized opportunities:

```bash
npm run cli -- research opportunities <projectId> --limit 25
```

The system deliberately avoids one opaque SEO score and exposes separate lenses:

- `strikingDistance`: Search Console average position 4–20, ranked by impressions
- `searchConsoleGaps`: average position >20 with impressions
- `highDemandUnclustered`: Google Ads demand with no cluster assignment
- `lowCompetitionDemand`: competition <= 0.4, ranked by demand × (1 − competition)

Research examples:

```bash
npm run cli -- research web <projectId> https://example.com/page
npm run cli -- research serp <projectId> "target query" --country jp --language ja
npm run cli -- research ads <projectId> "seed keyword" --language-id <criterionId> --geo <geoTargetId>
npm run cli -- research gsc <projectId> 2026-08-01 2026-08-31 --dimensions query
```

Search Console query imports update the latest clicks, impressions, CTR, and average position on the keyword record. The original external response remains persisted in `sources` as evidence.

## Content planning

Bulk-assign validated queries to one intent cluster:

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

Inspect overlap:

```bash
npm run cli -- page cannibalization <projectId>
```

Signals:

- `exactTargetConflicts`: multiple non-archived pages explicitly target the same keyword
- `sameClusterConflicts`: multiple non-archived pages belong to the same intent cluster

Agents stop at proposal creation. Human review only:

```bash
npm run cli -- page review <projectId> <pageId> approved
npm run cli -- page review <projectId> <pageId> rejected --reason "Duplicate intent"
npm run cli -- page review <projectId> <pageId> needs_edit --reason "Separate transactional intent first"
```

Normal approval is blocked by exact keyword-target overlap unless a human explicitly overrides it with a recorded reason.

## Research credentials

Credentials are environment-only and are never intentionally persisted to SQLite.

- SERP: `KEYWORDS_SERPER_API_KEY` or `SERPER_API_KEY`
- Google Ads: `GOOGLE_ADS_ACCESS_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`
- optional Google Ads: `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION`, language/geo defaults
- Search Console: `GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN`, `GOOGLE_SEARCH_CONSOLE_SITE_URL`
- shared OAuth fallback: `GOOGLE_OAUTH_ACCESS_TOKEN`

OAuth token refresh/issuance remains outside workspace persistence.

## Verification

GitHub Actions verifies:

- typecheck: domain, db, research, commands, api, cli, mcp, web
- SQLite initialization
- content-planning runtime smoke test
- policy-memory runtime smoke test
- agent work-loop runtime smoke test
- Web production build

CI cancels superseded runs on the same branch.

## Current autonomy boundary

Agents may research, organize keywords/clusters, create tasks/insights/policy candidates, and create evidence-backed page plans. Human approval remains required for page approval and durable policy activation. External publishing is intentionally **not implemented** yet.
