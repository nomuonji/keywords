# Agent-native Site Operations Architecture

Updated: 2026-09-17

This document describes the **current implemented architecture** of `nomuonji/keywords` and the remaining operational work required to prove the full SEO loop on real sites over time.

The governing rule remains **evolution, not replacement**: the existing SQLite/UI/runner/article-artifact workflow is the local execution plane, Git owns deployable article content, and Firestore provides the durable remote Agent control plane.

## 1. Current system boundary

The system is intentionally split by responsibility rather than by repository or Firebase project.

```text
Discovery / planning                     Real-site operations
────────────────────                    ──────────────────────────
Keywords Operator /mcp                  Sites Operator /sites-mcp

keywordTreasury                         sites
researchSessions                        articles (registry only)
siteStructures = Site Concepts          metricSnapshots
SERP cache / usage                      optimizationEvents
Ads-first research                      query opportunities
        │                                      │
        └──────────────┬───────────────────────┘
                       ▼
              Same Firestore project
                       │
                       ▼
          Local execution / persistent Agent
     SQLite + local MCP + Autopilot runner
                       │
          ┌────────────┼──────────────┐
          ▼            ▼              ▼
      GSC / GA4   Markdown/MDX     Ads / SERP
                       │
                       ▼
                 Git + deploy
                       │
                       ▼
                 Published site
```

There is no need for a second repository, second Firebase project, second scheduler, or Firestore article-body CMS.

## 2. Source-of-truth rules

### Git repository

Git is the source of truth for deployable site/article content:

- Markdown / MDX / structured content;
- page code and site configuration;
- revision history and diffs;
- commit attribution;
- rollback points.

Firestore article records point to `repo`, `repoPath`, and `currentCommitSha`; article body text is not duplicated into Firestore.

### SQLite

SQLite is the local execution source of truth for:

- Local UI state;
- projects/pages/keyword planning;
- work sessions, operations, leases and runner state;
- Blog bindings/handoffs/receipts;
- artifact validation and build state;
- local GSC/GA4 measurement imports;
- Autopilot controls/state;
- offline and development workflows.

The persistent worker is `scripts/autopilot-runner.ts`. Scheduling belongs to that worker rather than the public HTTP APIs.

### Firestore

Firestore is the durable remote Agent-facing control plane for:

- keyword research and Treasury;
- Site Concepts (`siteStructures`);
- instantiated real sites (`sites`);
- article registry metadata (`articles`);
- normalized GSC/GA4 aggregates (`metricSnapshots`);
- causal SEO experiment history (`optimizationEvents`).

## 3. Article and publication model

There is no standalone CRUD CMS row that owns article content.

The local content workflow uses:

- `pages` for planning/live-page identity and keyword intent;
- Markdown/MDX files for the actual body;
- `operation_artifacts` for artifact path/hash/source/build/revision evidence;
- `blog_handoffs` / `blog_receipts` for publication transport and evidence;
- `operation_outcomes` for local operation outcomes.

A content mutation is not considered delivered merely because a file was written. The delivery path requires the relevant operation/session, successful validation/build, Git evidence, and live publication proof before the optimization can be marked implemented.

For existing sites, autonomous content mutation is also gated by site-operations readiness. Measurement/research work is allowed to continue so an unready site can recover; mutation/delivery fails closed until the required operational state is restored.

## 4. Identity rules

Site and article identity are explicit and normalized.

### Real sites

`sites.productionUrl` is normalized before persistence/resolution. Equivalent variants such as default ports, query/hash noise and trailing-slash variants resolve to the same site identity. `localProjectId` remains the preferred explicit local-to-cloud mapping.

Normalized-equivalent production URLs are rejected as duplicates. Legacy unnormalized records are included in bounded identity checks. If the registry grows beyond the current bounded full-scan safety limit, the system fails closed rather than guessing uniqueness; at that scale an indexed normalized identity key should replace the scan.

### Articles

`articles.canonicalUrl` uses the same normalized web identity rules. Equivalent canonical variants cannot be registered as separate articles, preventing GA4/GSC projection ambiguity.

## 5. Remote MCP contracts

### Keywords Operator `/mcp`

The public discovery/planning MCP currently exposes 18 tools, including:

- keyword demand/SERP research;
- Treasury save/list/search;
- Site Concept list/get/save/patch;
- resumable research sessions;
- SERP quota/usage status;
- `keyword_screen_batch`;
- `keyword_research_pipeline`.

Google Ads screening is low-cost first-stage research. The shared bounded pipeline screens the batch with Ads first and spends SERP quota only on shortlisted candidates.

### Sites Operator `/sites-mcp`

The public real-site control-plane MCP currently exposes 16 tools:

- `remote_sites_status`;
- `site_registry_list`, `site_registry_get`, `site_registry_resolve`, `site_registry_save`;
- `site_article_list`, `site_article_get`, `site_article_save`;
- `site_metric_snapshot_save`, `site_metric_snapshot_list`;
- `optimization_event_create`, `optimization_event_list`, `optimization_event_update`;
- `optimization_context`;
- `optimization_evaluation_context`;
- `site_query_opportunities`.

### Local / persistent-Agent MCP

The local MCP is intentionally broader than either public remote MCP because it can see SQLite, Blog bindings, runner state and the local Git delivery environment.

It includes the Blog execution tools plus real-site optimization/readiness tools such as `site_operations_readiness` and the local optimization workflow. The absence of these execution/readiness tools from public `/sites-mcp` is deliberate, not an omission.

## 6. GSC and GA4 acquisition

### Search Console

GSC is a first-class local measurement provider with:

- bounded pagination;
- query and page snapshots;
- complete/partial/failed capture state;
- versioned `measurement_imports`;
- safe materialization rules so failed/partial captures do not overwrite prior complete evidence;
- compatibility checks for property/origin/filter/timezone/search type and equal non-overlapping comparison periods.

### Direct GA4

Direct GA4 Data API acquisition is implemented.

Supported authentication paths include configured access tokens, refresh credentials and `GOOGLE_APPLICATION_CREDENTIALS` service-account JWT exchange. Secret values are not returned through MCP/status responses.

Two report shapes are used:

1. **Site totals** — sessions, active users, engagement rate and screen/page views.
2. **Landing-page report** — bounded `landingPage` rows for exact article attribution.

Article-level GA4 is interpreted as sessions whose landing page maps to that registered canonical article. Query-string noise is excluded and ambiguous canonical mapping is skipped rather than summed.

GA4 is diagnostic/context evidence. The formal causal optimization evaluation remains GSC-driven so the before/after rule is consistent and comparable.

## 7. Deterministic measurement maintenance

The persistent runner already executes deterministic maintenance work. Current maintenance kinds are:

```text
capture_recovery
sync_site
capture_metrics
```

For `capture_metrics`, the worker currently:

1. captures two equal, non-overlapping complete GSC weekly periods;
2. persists them locally through shared measurement commands;
3. attempts direct GA4 collection for the same periods;
4. keeps GSC evidence even if GA4 collection fails;
5. projects normalized site/article metrics to Firestore;
6. treats Firestore projection as additive so local evidence survives cloud-projection failure.

This means the earlier proposed `sync_search_console` / `sync_ga4` / `project_metric_snapshots_to_firestore` migration is no longer future work; those responsibilities are implemented through the existing `capture_metrics` maintenance path.

## 8. Optimization PDCA

The implemented loop is:

```text
Observation
   │ GSC + GA4 snapshots
   ▼
Diagnosis
   ▼
Explicit hypothesis
   ▼
Exactly one content change
   ▼
Validation / build / Git / publication proof
   ▼
Implemented optimizationEvent
   ▼
Traffic-aware wait
   ▼
Compatible post-change GSC evidence
   ▼
Agent semantic verdict
   ▼
Persist result + next action
```

Important invariants:

- only one implemented + unevaluated optimization may exist per article;
- daily/periodic measurement collection may continue during the wait;
- a second implemented content change is blocked until the active hypothesis is evaluated or cancelled;
- numerical evaluation metrics are recomputed server-side from saved compatible snapshots and are not accepted from an Agent as invented evidence;
- the Agent chooses the semantic result (`improved`, `neutral`, `worsened`, `inconclusive`) against the persisted hypothesis.

### Traffic-aware evaluation window

The default minimum is 14 days, but the effective wait is traffic-aware:

- high traffic: 14 days;
- medium traffic: 21 days;
- low traffic: 28 days.

Traffic class changes the wait only. It does not automatically decide whether an optimization succeeded.

Evaluation requires a complete article-level GSC baseline exactly matching the persisted baseline period and an equal-length complete post period that starts after the change and reaches the effective evaluation date.

## 9. Keywords ↔ Sites feedback loop

The GSC feedback path is implemented as an Agent-native, quota-safe sequence:

```text
compatible site-level GSC snapshots
          │
          ▼
site_query_opportunities
(newly observed / rising queries)
          │
          ▼
keyword_screen_batch
(Google Ads first; no SERP)
          │
          ▼
keyword_research_pipeline
(bounded SERP only for shortlisted terms)
          │
          ▼
keyword_treasury_save
(explicit, evidence/provenance-preserving write)
```

`site_query_opportunities` itself deliberately does not spend SERP quota or write Treasury. Likewise, `keyword_research_pipeline` does not blindly auto-save. The final Treasury write remains an explicit Agent action so provenance and selection remain auditable while still being executable end-to-end by an Agent without bypassing Ads-first/SERP-budget policy.

Because GSC stores a bounded top-query set, a query absent from the previous snapshot is described as **newly observed**, not asserted to have never existed.

## 10. Firestore real-site schema

### `sites`

Real instantiated sites, separate from Site Concepts. Important fields include:

```ts
{
  id,
  siteConceptId,
  localProjectId,
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

Registry only; no body text:

```ts
{
  id,
  siteId,
  localPageId,
  canonicalUrl,
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

Provider-neutral aggregate observations:

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

Deterministic IDs + `sourceVersion` make projection idempotent.

### `optimizationEvents`

Durable causal SEO history:

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

## 11. CI and deployment safety

Current repository safeguards include:

- Node runtime pinned to `22.x` for project builds;
- runtime acceptance suite plus per-workspace TypeScript checks;
- `npm audit --audit-level=high` security gate with JSON audit artifact;
- patched direct Drizzle ORM dependency at `0.45.2` after the SQL-identifier injection advisory;
- Vercel Git deployments restricted to `main` using a recursive `**` catch-all denial, preventing slash-named feature branches from consuming preview-build quota;
- production health endpoints expose deployed Git SHA for verification.

## 12. Implemented migration status

The original migration plan is now mostly complete at code level:

1. **Inventory / no-destructive-change** — complete.
2. **Cloud control-plane foundation** — complete.
3. **Explicit real-site/local-project mapping** — implemented; actual per-site registration remains an operational onboarding task.
4. **Article registry projection** — implemented for confirmed Blog articles; Git remains body source of truth.
5. **GSC analytics bridge** — complete.
6. **Direct GA4 site + article landing-page acquisition** — complete.
7. **Runner measurement/projection maintenance** — complete through `capture_metrics`.
8. **Existing-page optimization PDCA** — complete at code/workflow level.
9. **Readiness-gated autonomous mutation** — complete at code/workflow level.
10. **Traffic-aware 14/21/28-day evaluation** — complete at code level; real elapsed-time evaluations still require production data and time.
11. **GSC query feedback → Ads-first → bounded SERP → Treasury** — Agent-operable end-to-end path complete; Treasury save intentionally remains explicit rather than blind automatic persistence.
12. **BigQuery/raw analytics warehouse** — intentionally deferred until Firestore aggregate volume justifies it.

## 13. What is still not complete

The remaining work is primarily operational proof and scale hardening, not another replacement architecture.

### Real-world operational proof

For each real production site that should participate in the loop:

- register/verify the explicit `site` ↔ local project ↔ repository ↔ production URL mapping;
- verify the actual GSC property and GA4 property/credentials;
- run the persistent runner continuously with real credentials;
- observe real `capture_metrics` cycles and Firestore projections;
- execute at least one real existing-page optimization through build/deploy/publication proof;
- allow the required 14/21/28-day interval to elapse;
- evaluate against compatible post-change GSC data and record the result;
- feed resulting GSC query opportunities through the bounded keyword research path.

A smoke test cannot substitute for this elapsed-time production proof.

### Scale / reproducibility hardening

Potential later improvements, only when justified:

- replace bounded production-URL full scans with an indexed normalized identity key if the real-site registry grows beyond the safe scan bound;
- introduce BigQuery/raw analytics storage when aggregate Firestore snapshots cease to be sufficient;
- improve package-install reproducibility with a committed lockfile/`npm ci` workflow if the repository adopts a lockfile policy;
- continue tightening observability around persistent-runner liveness and real-site execution outcomes.

## 14. Explicit non-goals

- No second Firebase project.
- No separate repository solely for Sites Operator.
- No Firestore article-body duplication.
- No replacement of SQLite or the Local UI.
- No second queue/scheduler beside the persistent runner.
- No daily blind article rewriting.
- No direct SERP calls from Sites Operator that bypass Keywords Operator quota policy.
- No automatic optimization verdict based only on a numeric threshold.
- No credentials in Firestore records, MCP-returned logs or public status responses.
