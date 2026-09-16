# Sites Operator Analytics Bridge

Updated: 2026-09-16

This document is the implementation addendum to `site-operations-architecture.md`. It records the implemented analytics projection, optimization-evaluation evidence, traffic-aware waits, GSC-to-Keywords feedback loop, and confirmed Blog-article registry synchronization.

## Goal

Reuse the existing local SEO operating plane instead of introducing a second scheduler or a second analytics collector.

```text
existing Autopilot runner
        │
        ├─ capture_metrics
        │     ├─ existing GSC capture -> SQLite
        │     └─ cloud projection
        │             ├─ confirmed Blog source mapping -> Firestore article registry
        │             ├─ GSC -> Firestore metricSnapshots
        │             └─ saved analytics-dashboard GA4 -> metricSnapshots
        │
        ├─ due optimization check
        │     └─ evaluate_site_optimization Operation
        │             ├─ site_optimization_evaluation_context
        │             └─ site_optimization_record_result
        │
        └─ GSC query feedback check
              └─ research_site_queries Operation
                    ├─ keyword_research_pipeline
                    │     ├─ Google Ads proxy
                    │     ├─ direct Ads fallback
                    │     └─ bounded cached SERP for shortlist only
                    └─ keyword_treasury_save (selected candidates only)
```

The bridge does not change canonical ownership of article bodies, local execution state, or raw measurement acquisition.

## Explicit identity links

Cloud records do not infer local identity from names.

`sites` adds `localProjectId`. `articles` adds `localPageId` and `canonicalUrl`. `site_registry_resolve` resolves a real site by explicit `localProjectId` or exact `productionUrl`; duplicate mappings are rejected.

Article-level GSC projection uses `localPageId` first and `canonicalUrl` second. If neither matches, the bridge skips that page rather than guessing.

### Confirmed Blog article registry sync

Real-site registration remains explicit: repository, production URL and deployment identity are not inferred. After a real site has been linked to a local project with `localProjectId`, the bridge can reuse the already human-confirmed `blog_bindings` snapshot to register article metadata before page-level GSC projection.

The sync requires exact agreement between the registered production origin, `blog_bindings.origin`, and the Blog snapshot `canonical_origin`. Each `snapshot.sources[].expected_url` must resolve to exactly one local page. The Firestore record mirrors only identity fields already established by that binding: `localPageId`, exact canonical URL, registered repository, `source_ref` as `repoPath`, title and URL-derived slug.

The bridge fails closed on origin mismatch, ambiguous local pages, or conflicting existing article mappings. It never treats a local build as proof of publication. Newly mirrored records therefore remain `draft` unless publication state was already established through another trusted path. Existing article status is preserved on metadata refresh.

Automatic article synchronization is bounded by `KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT`, default `100`, per projection. Excess confirmed sources are deferred to a later projection rather than making one maintenance operation unbounded.

## GSC flow

The existing `metrics.capture` command remains the only GSC acquisition path. `capture_metrics` captures two equal, non-overlapping seven-day periods. After those observations have been materialized locally, the maintenance worker calls the projection bridge.

Only complete GSC `measurement_imports` are projected. Partial and failed captures remain local observations and are not promoted into cloud decision state.

Site-level snapshots include clicks, impressions, CTR, average position, and the top 200 queries by impressions. Article-level snapshots include the page-level GSC metrics already materialized in SQLite. The bridge does not fabricate query×page rows when the local capture did not collect that dimension.

All writes use `site_metric_snapshot_save`, so repeated projection of the same source version is idempotent. A fresh projection invalidates both the optimization-evaluation and query-feedback probe caches so newly available evidence can enter the existing runner immediately.

## GA4 flow

Direct GA4 Data API collection is not duplicated inside `keywords`. The repository already reads the persisted `analytics-dashboard/data/latest.json` snapshot. The bridge reuses that observation source and projects its current/previous site-level GA4 totals into Firestore. Article-level GA4 is not created because the current saved dashboard source is site-level only.

## Optimization evaluation evidence

`optimization_evaluation_context` is read-only. It finds one persisted optimization event and builds a compatible before/after GSC evidence packet. The baseline must be complete article-level GSC for the exact persisted `baselinePeriod`. The post snapshot must be complete, equal in duration, start after the change, and reach the effective evaluation date.

The tool returns absolute and relative deltas for clicks, impressions, CTR, and average position. It does **not** automatically label the result improved/neutral/worsened. The hypothesis is semantic and already persisted in `optimizationEvents`; the Agent compares compatible deltas to that hypothesis and records the result only after the wait has matured.

### Traffic-aware minimum wait

The persisted `optimizationEvent.evaluateAfter` remains a hard minimum and is never shortened. A derived traffic policy may extend that wait to avoid forcing sparse pages into a premature verdict.

Baseline clicks and impressions are normalized to a seven-day rate. Defaults are:

| baseline traffic (7-day normalized) | derived minimum wait |
| --- | ---: |
| impressions >= 500 **or** clicks >= 20 | 14 days |
| impressions >= 100 **or** clicks >= 5 | 21 days |
| below both medium thresholds | 28 days |

The effective evaluation date is `max(persisted evaluateAfter, changedAt + derived minimum wait)`.

Configuration:

```text
KEYWORDS_OPTIMIZATION_FAST_IMPRESSIONS_7D=500
KEYWORDS_OPTIMIZATION_FAST_CLICKS_7D=20
KEYWORDS_OPTIMIZATION_MEDIUM_IMPRESSIONS_7D=100
KEYWORDS_OPTIMIZATION_MEDIUM_CLICKS_7D=5
```

These thresholds affect **wait time only**. They never determine whether a result is improved, neutral, worsened, or inconclusive. After the maximum derived wait of 28 days, the Agent may still choose `inconclusive` when compatible evidence remains too sparse to support the persisted hypothesis.

### Autopilot evaluation handoff

The local Operator performs a bounded Sites check for linked `existing_site` projects. When an implemented/pending optimization has reached its traffic-adjusted effective evaluation date **and** a compatible GSC baseline/post pair exists, it emits `evaluate_site_optimization`.

The ordinary Autopilot runner turns that candidate into a shared Operation; no second worker exists. The persistent execution Agent receives:

```text
site_optimization_evaluation_context
site_optimization_record_result
```

The first returns the persisted observation, diagnosis, hypothesis, evaluation-window policy, and compatible deltas. The second accepts only the semantic result, notes, and expected revision. The Agent cannot submit evaluation metric numbers: the command recomputes them from saved snapshots immediately before the optimistic Firestore update.

Evaluation is a measurement-only Operation. It must not edit the article or start a second optimization.

## GSC query feedback loop

`site_query_opportunities` compares only complete, equal-length, non-overlapping site-level GSC snapshots. The snapshots retain a bounded saved top-query set, so the tool distinguishes `newly_observed_query` and `rising_query`.

`newly_observed_query` means the query is present in the current saved query set but absent from the previous saved query set. It is **not** proof that the query never existed in Search Console before. The output therefore keeps `queryCoverage = bounded_saved_top_queries` and the caveat on newly observed rows.

### Autopilot research handoff

The local Operator now also performs a low-priority query-feedback check when the project has no active review, discovery job, work session, or agent task, and recovery policy allows expansion. When a compatible GSC pair contains candidates, the Operator emits:

```text
kind = research_site_queries
relatedType = site_query_snapshot
relatedId = latest metricSnapshot.id
```

The latest GSC snapshot ID pins the research batch. The same snapshot ID is not queued twice: existing `operation_requests` are checked before creating another candidate. This means an interrupted Agent resumes the same evidence instead of silently switching to a newer GSC period.

The operation carries the bounded GSC candidate rows, previous snapshot ID, query-coverage semantics, screening criteria, and a hard `maxSerpChecks` value. Defaults are:

```text
KEYWORDS_SITE_QUERY_FEEDBACK_CHECK_MINUTES=60
KEYWORDS_SITE_QUERY_MIN_IMPRESSIONS=20
KEYWORDS_SITE_QUERY_MIN_GROWTH_RATIO=1.5
KEYWORDS_SITE_QUERY_FEEDBACK_LIMIT=20
KEYWORDS_SITE_QUERY_MAX_SERP_CHECKS=5
```

The persistent Agent uses the local Keywords MCP shared tools:

```text
keyword_screen_batch
keyword_research_pipeline
keyword_treasury_save
```

`keyword_research_pipeline` executes in this order:

```text
all pinned GSC candidates
        ↓
Google Ads demand: proxy first
        ↓ proxy failure only
direct Google Ads fallback
        ↓
deterministic screening
        ↓ passing top candidates only
cached / quota-aware SERP
        ↓ Agent selection
Keyword Treasury
```

The local persistent Agent uses a shared research-layer direct Google Ads implementation and therefore does not call the remote `/mcp` endpoint over HTTP to reuse Ads credentials/provider behavior. The Vercel `/mcp` entrypoint keeps its existing self-contained direct-Ads implementation for serverless bundling/backward compatibility; the provider semantics remain the same, while the local feedback execution path is shared through the command layer.

SERP is never called before Ads screening and `maxSerpChecks` remains a hard per-operation bound. Existing monthly SERP quota/cache rules still apply. If quota/reserve stops the loop, the pipeline returns the stopping reason rather than bypassing the quota.

Treasury is **not** an automatic dump of GSC queries. The Agent saves only candidates it decides are worth retaining after reading the Ads/SERP evidence. GSC-derived entries must preserve provenance with `source = gsc_feedback` and evidence containing at least the real site ID, latest/previous GSC snapshot IDs, and the original GSC candidate row. The command layer rejects `gsc_feedback` saves that omit this provenance.

The feedback Operation is research-only: it reuses the existing `measurementOnly` permission boundary so Autopilot does not grant content planning or content delivery in this Operation. The dedicated Treasury write remains available through the local MCP action budget. The operation does not create or modify an article or Site Concept; those remain later decisions in the Keywords domain.

## Cadence

- sitemap/live URL inventory: 7-day freshness threshold
- GSC measurement collection: `KEYWORDS_METRICS_CADENCE_HOURS`, default `24`
- Blog article registry sync: immediately before metric projection, bounded by `KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT`, default `100`
- GSC comparison windows: equal-length saved periods
- optimization due-check cache: `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES`, default `30`; ready work is not cached
- optimization evaluation: persisted minimum plus derived 14/21/28-day traffic wait
- GSC query-feedback non-ready cache: `KEYWORDS_SITE_QUERY_FEEDBACK_CHECK_MINUTES`, default `60`; fresh metric projection invalidates it
- query feedback is lower priority than measurement/recovery/optimization evaluation and does not create a second scheduler

## Failure behavior

Cloud projection and remote analysis are additive and cannot invalidate locally captured evidence.

- Firestore not configured -> Sites evaluation/query-feedback discovery is skipped
- no `localProjectId` mapping -> Sites discovery is skipped
- no confirmed Blog binding -> article registry sync is skipped; existing explicit article mappings still work
- Blog origin differs from the registered production origin -> article registry sync fails closed
- a Blog source URL maps to zero or multiple local pages -> that article is skipped rather than guessed
- localPageId and canonicalUrl point to different Firestore articles -> that article is skipped with a conflict warning
- GA4 saved snapshot unavailable -> GSC can still project
- Firestore projection error -> maintenance retains successful local GSC capture
- ambiguous mappings -> fail closed rather than infer identity
- no exact optimization baseline -> evaluation stays not-ready
- traffic-adjusted wait not mature -> no evaluation Operation is created
- no compatible optimization post period -> evaluation stays not-ready
- no compatible site GSC pair -> no query-feedback Operation is created
- no GSC candidates over configured thresholds -> no query-feedback Operation is created
- Google Ads proxy failure -> direct Ads fallback is attempted
- both Ads routes fail -> research Operation records the real provider failure; SERP is not used as fake demand evidence
- SERP quota/reserve reached -> pipeline stops bounded SERP checks rather than bypassing the limit

## Source-of-truth boundaries

```text
Git / Markdown / MDX
  -> article body + revision history

SQLite
  -> local execution, queues, runner, GSC materialization, Local UI

Firestore
  -> remote Agent control plane, site/article registry, normalized snapshots,
     optimization hypotheses/outcomes, Keyword Treasury and Site Concepts
```

No existing SQLite migration is required for this bridge.

## Remaining work

1. Register each real production site once with an explicit `localProjectId`, repository and production URL. The system deliberately does not guess deployment identity.
2. For confirmed Blog-bound sources, article registry metadata now syncs automatically before metric projection. Non-Blog/custom articles still need explicit `localPageId` and/or `canonicalUrl` registration when article-level GSC tracking is required.
3. Run the persistent Autopilot with Firebase/Sites/Ads credentials available so optimization evaluation and query feedback can enter the shared queue.
4. Consolidate the Vercel `/mcp` Ads/provider wrapper with the local shared implementation only if a later serverless bundling pass can preserve the existing production contract cleanly.
5. Add direct GA4 Data API collection only if the existing analytics-dashboard acquisition path should be consolidated into this repository.
6. Consider article-level GA4 only when a trustworthy page-scoped acquisition source exists.
