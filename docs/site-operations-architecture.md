# Agent-native Site Operations Architecture

Updated: 2026-09-16

This document records the code-level inventory of the existing `nomuonji/keywords` article/SEO operating system and the migration path toward a continuous Agent-native site operations platform.

The main rule is **evolution, not replacement**. The existing local SQLite/UI/runner/article-artifact workflow remains the execution plane. Firestore adds a cloud control plane that ChatGPT can safely reach through a separate Sites Operator MCP.

## 1. What actually exists today

The older mental model of a standalone `Article` CRUD CMS with `articles_*` MCP tools is no longer accurate.

### Article/content model

There is no single database row that owns article body text.

- `pages`: planning and live-page identity, keyword targeting, intent, evidence and URL state.
- `operation_artifacts`: manifest for a real article file, including `artifact_path`, SHA-256, source IDs, validator/build results, before/after hash, revision counters and verification state.
- Markdown/MDX files under the configured Blog root: **actual article body source of truth**.
- `blog_handoffs` / `blog_receipts`: publication transport and evidence.
- `operation_outcomes`: local operation-level hypothesis/publication/evaluation state.

The Articles UI scans real `.md`/`.mdx` files and combines unregistered local files with persisted `operation_artifacts`. A verified artifact may be committed/pushed as the single target file when auto Git delivery is enabled.

### SQLite

Default database: `data/keywords.sqlite`.

The database bootstrap is additive and preserves legacy data. Before the Blog integration tables are first added to an existing DB, a consistent `VACUUM INTO` pre-integration backup is created.

Important tables include:

- `projects`, `topics`, `keywords`, `clusters`, `pages`, `page_keywords`
- `keyword_metric_snapshots`, `page_metric_snapshots`
- `sources`, `source_links`, `insights`, `tasks`, `decisions`, `policy_rules`
- `work_sessions`, `work_checkpoints`, `review_requests`
- `discovery_jobs`, `discovery_request_reservations`, `discovery_candidates`
- `runs`
- `blog_bindings`, `blog_briefs`, `blog_handoffs`, `blog_receipts`
- `operation_requests`, `operation_projects`, `operation_controls`, `operation_delegations`
- `operation_executors`, `operation_budget_reservations`, `operation_events`, `operation_outcomes`
- `autopilot_controls`, `autopilot_state`
- `measurement_imports`
- `operation_artifacts`

The old generic `jobs` / `schedules` / `events` picture has evolved into domain-specific operation/discovery queues, `operation_events`, per-project Autopilot cadence/state, and the persistent runner.

### Local API and UI

- Local API defaults to `127.0.0.1:8787`.
- Vite local UI uses the existing `5173` development origin.
- API writes from an Agent are forced through the delegated `/operations` lane; human and agent bearer tokens are distinct when configured.
- The Local UI already includes article, operations, sites, keyword treasury and site structure views.

### CLI / local MCP

The local MCP is broader than the remote Keywords Operator. It exposes work/operation/research/page/site/measurement and Blog tools.

Current Blog tools include:

- `blog_context`, `blog_contract`, `blog_prepare`, `blog_export`, `blog_get`
- `blog_writeDraft`, `blog_validateDraft`, `blog_artifactContext`
- `blog_receipt`, `blog_verifyPublished`
- `blog_capture`, `blog_evaluate`
- discovery/observation helpers

The old `articles_list/articles_add/...` MCP contract is not the current implementation.

### Runner / scheduling

`scripts/autopilot-runner.ts` is the persistent execution worker.

It already handles:

- executor registration, generation and leases
- heartbeat / stale recovery
- per-project due work
- Autopilot ticks
- operation claiming
- deterministic maintenance execution
- external Agent process execution
- artifact completion reconciliation
- revision reconciliation
- provider/executor failure cooldown

Scheduling intentionally belongs to this persistent worker, not the HTTP API. Per-project cadence lives in `autopilot_controls`; `autopilot_state.next_tick_at` records the next due time.

### Public-site linkage and Git

The existing Blog integration already has the right direction for content ownership:

1. local Markdown/MDX is written atomically under the configured Blog root;
2. an artifact manifest is persisted;
3. source validation and the real site build run;
4. an allowed site can commit/push only that verified artifact;
5. Keywords directly checks HTTP 200 and canonical after delivery;
6. publication and later observation are recorded.

This mechanism should be reused rather than replaced by Firestore article-body storage.

### GSC / GA4

GSC is already a first-class local measurement provider:

- API capture with bounded pagination;
- query and page snapshots;
- complete/partial/failed capture state;
- versioned `measurement_imports`;
- failed or partial captures do not overwrite prior successful materialized metrics;
- comparisons require compatible property/origin/filter/timezone/search-type and equal non-overlapping periods.

GA4 is **not yet fetched directly by this repository**. Portfolio GA4 currently comes from `analytics-dashboard/data/latest.json`, where the reader expects sessions, active users, engagement and views alongside GSC totals. The new cloud schema therefore accepts GA4 snapshots now, while direct GA4 collection remains a later migration step.

## 2. Current architecture

```text
                         ┌────────────────────────────┐
                         │ Remote Keywords Operator   │
                         │ /mcp                       │
                         │ Firestore research plane   │
                         └─────────────┬──────────────┘
                                       │
                    keywordTreasury / researchSessions /
                    siteStructures / SERP cache + usage
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    nomuonji/keywords local plane                    │
│                                                                     │
│  Local UI ──► API/CLI/local MCP ──► Commands/Core                   │
│                                      │                              │
│                                      ▼                              │
│                     SQLite data/keywords.sqlite                     │
│   pages / jobs / work / operations / events / outcomes / metrics   │
│                                      │                              │
│                                      ▼                              │
│                          Autopilot Runner                           │
│                       operation + executor leases                   │
│                                      │                              │
│                  ┌───────────────────┴──────────────────┐           │
│                  ▼                                      ▼           │
│        Markdown/MDX article files               GSC / SERP / Ads    │
│        + validation/build                       measurement/research │
│                  │                                                  │
│                  ▼                                                  │
│             Git commit/push                                             │
└──────────────────┼──────────────────────────────────────────────────┘
                   ▼
              Published site
                   │
                   └────► HTTP/canonical verification ──► outcomes
```

## 3. Reuse classification

| Existing capability | Decision | Reason |
|---|---|---|
| `pages` planning/live identity | **Extend** | Already links intent, URLs and keyword evidence. Do not invent a parallel local article model. |
| Markdown/MDX body files | **Use as-is** | Correct source of truth; Git provides diff/revision/rollback. |
| `operation_artifacts` | **Use as-is locally** | Already records file hash, source evidence, validation/build and revisions. |
| `operation_outcomes` | **Extend/bridge** | Good local operation outcome; cloud cross-session SEO hypothesis history needs a dedicated Firestore projection. |
| SQLite | **Keep** | Required by UI, local execution, offline/dev and deterministic runner state. |
| Local UI | **Keep and later enrich** | Already provides operational visibility and article file inspection. |
| Commands/Core | **Use as service layer** | Existing write policy/auditing should remain the local execution boundary. |
| Local API/CLI/MCP | **Keep** | Mature delegated execution interface; no need to recreate it in the cloud. |
| Autopilot runner | **Use as scheduler/executor** | Avoid a second queue/scheduler. Future analytics sync jobs should become deterministic maintenance work here. |
| GSC capture | **Use/bridge** | Already handles scope, completeness, pagination and safe comparison correctly. |
| GA4 portfolio JSON | **Temporary compatibility path** | Useful read model, but direct GA4 API capture still needs implementation. |
| Firestore keyword/site-concept state | **Use as-is** | Already supports cross-session remote Agent work. |
| Old article CRUD MCP idea | **Do not recreate** | Current artifact/file workflow is safer and richer. |
| New repository | **Not needed now** | Responsibilities can be split at MCP/domain level without splitting deployment or source tree. |

## 4. Target architecture

The repository stays unified, while responsibilities are separated by remote MCP boundary.

```text
Keywords domain                           Sites / Operations domain
────────────────────                     ───────────────────────────
Keywords Operator /mcp                   Sites Operator /sites-mcp

keywordTreasury                          sites
researchSessions                         articles (registry only)
siteStructures = Site Concepts           metricSnapshots
SERP cache / quota                       optimizationEvents

"What should we build?"                 "How is the real site doing?"
                │                                      │
                └──────────────┬───────────────────────┘
                               ▼
                     Same Firestore project
                               │
                     cloud control / memory
                               │
                               ▼
                 Existing local operation plane
              SQLite + runner + article artifacts
                               │
                               ▼
                  Git repository / deployment
```

This deliberately separates **MCP responsibility** without forcing **repository separation**.

## 5. Source-of-truth rules

### Firestore

Cloud/Agent-operable durable state:

- research and keyword treasury
- Site Concepts
- real-site registry
- article registry metadata
- normalized GSC/GA4 metric snapshots
- optimization hypotheses and results

### Git repository

Canonical article/page body and deployable code/data:

- Markdown / MDX / structured content
- revision history and diffs
- commit attribution
- rollback point

Firestore article rows point to `repo`, `repoPath`, and `currentCommitSha`; they do **not** duplicate body text.

### SQLite

Local execution source of truth:

- Local UI read/write state
- work sessions / queues / leases
- operation and evidence state
- artifact validation/build state
- local GSC measurement materialization
- offline/development workflows

SQLite is not migrated away in this phase.

## 6. Firestore collections added by Sites Operator

### `sites`

Real, instantiated sites; separate from `siteStructures` Site Concepts.

```ts
{
  id,
  siteConceptId,
  name,
  repository,
  productionUrl,
  deploymentProvider,
  ga4PropertyId,
  searchConsoleProperty,
  status,
  revision,
  createdAt,
  updatedAt
}
```

### `articles`

Registry only; no article body.

```ts
{
  id,
  siteId,
  repo,
  repoPath,
  currentCommitSha,
  slug,
  title,
  primaryKeywordId,
  secondaryKeywordIds,
  status,
  publishedAt,
  lastUpdatedAt,
  revision,
  createdAt,
  updatedAt
}
```

### `metricSnapshots`

Provider-neutral period observations.

```ts
{
  id,
  siteId,
  articleId,
  provider: 'gsc' | 'ga4',
  periodStart,
  periodEnd,
  metrics,
  queries,
  completeness,
  sourceVersion,
  capturedAt,
  createdAt
}
```

`sourceVersion` + deterministic IDs make ingestion idempotent. Partial/failed states are explicit.

### `optimizationEvents`

Dedicated causal SEO experiment history.

```ts
{
  id,
  siteId,
  articleId,
  observation,
  diagnosis,
  hypothesis,
  actionType,
  beforeCommit,
  afterCommit,
  baselinePeriod,
  changedAt,
  evaluateAfter,
  phase,
  result,
  evaluationMetrics,
  notes,
  revision,
  createdAt,
  updatedAt
}
```

Invariant: **only one implemented + unevaluated optimization may exist per article**. Implemented changes default to a 14-day wait. Daily metric collection remains allowed during the wait.

## 7. Remote MCP split

### Keywords Operator `/mcp`

Unchanged contract. It remains the discovery/planning side and retains the existing 18 tools.

### Sites Operator `/sites-mcp`

Initial tools:

- `remote_sites_status`
- `site_registry_list`, `site_registry_get`, `site_registry_save`
- `site_article_list`, `site_article_get`, `site_article_save`
- `site_metric_snapshot_save`, `site_metric_snapshot_list`
- `optimization_event_create`, `optimization_event_list`, `optimization_event_update`
- `optimization_context`

The two MCPs share the same Vercel project, Firebase project and existing OAuth signing secret. Tool responsibility is separate; infrastructure is not duplicated.

## 8. PDCA model

```text
Observation
   │ metricSnapshots
   ▼
Diagnosis
   │ optimizationEvent.diagnosis
   ▼
Hypothesis
   │ exactly one explicit hypothesis
   ▼
Action
   │ Git beforeCommit -> afterCommit
   ▼
Deploy
   │ existing artifact/build/Git/publish verification path
   ▼
Wait
   │ evaluateAfter / no second implemented change
   ▼
Evaluation
   │ improved | neutral | worsened | inconclusive
   ▼
Next action
```

The cloud event is not a replacement for local `operation_events` or `operation_outcomes`. It is the durable cross-session causal record that links analytics to Git revisions and can be consumed by a remote Agent.

## 9. Analytics migration

### Phase 1 — implemented foundation

- Keep existing local GSC collection untouched.
- Accept idempotent GSC and GA4 snapshots into Firestore via Sites Operator.
- Preserve completeness/source version metadata.
- Let `optimization_context` surface latest GSC + GA4 observations and the active cooldown.

### Phase 2 — next

Add deterministic runner maintenance work:

```text
sync_search_console
sync_ga4
project_metric_snapshots_to_firestore
```

The runner should call existing local GSC capture, normalize the result, then project it to Firestore. GA4 should be collected with a service account/OAuth credential stored only in the runtime secret store, never Firestore or MCP responses.

### Phase 3 — scale

When raw analytics volume makes Firestore inefficient:

```text
GA4 ─┐
     ├─► BigQuery/raw analytics
GSC ─┘
          │
          ▼ aggregate
     Firestore control state
```

`metricSnapshots` remains the small Agent-facing aggregate, so Sites Operator contracts do not need to change.

## 10. Keywords ↔ Sites feedback loop

Site Concepts and real Sites remain separate:

```text
keywordTreasury
     │
     ▼
siteStructures (concept)
     │ siteConceptId
     ▼
sites (real deployment)
     │
     ▼
articles
     │
     ▼
metricSnapshots + optimizationEvents
     │
     └──── discovered GSC queries ───► keywordTreasury
                                      │
                                      ├─► Google Ads screening
                                      └─► SERP only for shortlisted terms
```

The final feedback write from new GSC query to Keyword Treasury is intentionally not automated in this first slice. Existing Keywords Operator screening/quota logic should own that step, so Sites Operator does not bypass Google Ads-first / SERP-budget policy.

## 11. Migration plan

1. **Inventory / no-destructive-change** — complete. Keep SQLite schema, local UI, local MCP and runner untouched.
2. **Cloud control-plane foundation** — add `sites`, `articles`, `metricSnapshots`, `optimizationEvents` and `/sites-mcp`.
3. **Register existing production sites** — create `sites` rows linked to the relevant Site Concept when one exists; do not invent concepts for legacy sites.
4. **Project existing local article metadata** — map verified/published `operation_artifacts` to Firestore article registry records with repo path + current Git SHA. Do not upload body text.
5. **Analytics bridge** — reuse local GSC capture and add GA4 collection; project normalized daily/period snapshots to Firestore.
6. **Runner maintenance kinds** — schedule collection/evaluation through the existing persistent runner rather than a new scheduler.
7. **Optimization execution** — initially generate candidates only. Automatic article edits should require an active event, respect cooldown, use the existing artifact/build/Git flow, then write `afterCommit`.
8. **Keyword feedback** — send genuinely new GSC queries back through Keywords Operator Treasury → Ads → bounded SERP research.
9. **BigQuery only when justified by volume** — keep Firestore as the Agent-facing aggregate/control plane.

## 12. Explicit non-goals in this migration

- No second Firebase project.
- No new repository solely to host Sites Operator.
- No Firestore article-body duplication.
- No replacement of SQLite or the Local UI.
- No second queue/scheduler beside the existing runner.
- No daily blind article rewriting.
- No direct SERP calls from Sites Operator that bypass Keywords Operator quota policy.
- No credentials in Firestore records, logs returned to MCP, or tool status responses.
