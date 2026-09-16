# Sites Operator Analytics Bridge

Updated: 2026-09-16

This document is the implementation addendum to `site-operations-architecture.md`. It records the implemented analytics projection, optimization-evaluation evidence, GSC-query feedback boundary, and Autopilot evaluation handoff.

## Goal

Reuse the existing local SEO operating plane instead of introducing a second scheduler or a second analytics collector.

```text
existing Autopilot runner
        │
        ├─ capture_metrics
        │     ├─ existing GSC capture -> SQLite
        │     └─ cloud projection
        │             ├─ GSC -> Firestore metricSnapshots
        │             └─ saved analytics-dashboard GA4 -> metricSnapshots
        │
        ├─ due optimization check
        │     └─ evaluate_site_optimization Operation
        │             ├─ site_optimization_evaluation_context
        │             └─ site_optimization_record_result
        │
        └─ Sites Operator read models
               ├─ optimization_evaluation_context
               └─ site_query_opportunities
```

The bridge is a projection/analysis layer. It does not change the canonical ownership of article bodies, local execution state, or raw measurement acquisition.

## Explicit identity links

Cloud records do not infer local identity from names.

`sites` adds:

```ts
localProjectId: string | null
```

`articles` adds:

```ts
localPageId: string | null
canonicalUrl: string | null
```

`site_registry_resolve` resolves a real site by explicit `localProjectId` or exact `productionUrl`. Duplicate local-project mappings are rejected.

Article-level GSC projection uses `localPageId` first and `canonicalUrl` second. If neither matches, the bridge skips that page rather than guessing.

## GSC flow

The existing `metrics.capture` command remains the only GSC acquisition path.

`capture_metrics` captures two equal, non-overlapping seven-day periods. After those observations have been materialized locally, the maintenance worker calls the projection bridge.

Only `measurement_imports` where:

```text
provider = gsc
completeness = complete
```

are projected. Partial and failed captures remain local observations and are not promoted into cloud decision state.

Site-level snapshots include clicks, impressions, CTR, average position, and the top 200 queries by impressions. Article-level snapshots include the page-level GSC metrics already materialized in SQLite. The bridge does not fabricate query×page rows when the local capture did not collect that dimension.

All writes use `site_metric_snapshot_save`, so repeated projection of the same source version is idempotent.

## GA4 flow

Direct GA4 Data API collection is not duplicated inside `keywords`. The repository already reads the persisted `analytics-dashboard/data/latest.json` snapshot. The bridge reuses that observation source and projects its current/previous site-level GA4 totals into Firestore. Article-level GA4 is not created because the current saved dashboard source is site-level only.

## Optimization evaluation evidence

`optimization_evaluation_context` is read-only. It finds one persisted optimization event and builds a compatible before/after GSC evidence packet. The baseline must be complete article-level GSC for the exact persisted `baselinePeriod`. The post snapshot must be complete, equal in duration, start after the change, and reach the effective evaluation date.

The tool returns absolute and relative deltas for clicks, impressions, CTR, and average position. It does **not** automatically label the result improved/neutral/worsened. The hypothesis is semantic and already persisted in `optimizationEvents`; the Agent compares compatible deltas to that hypothesis and records the result only after the wait has matured.

### Traffic-aware minimum wait

The persisted `optimizationEvent.evaluateAfter` remains the hard minimum and is never shortened. A derived traffic policy may extend that wait to avoid forcing sparse pages into a premature verdict.

Baseline clicks and impressions are normalized to a seven-day rate. Defaults are:

| baseline traffic (7-day normalized) | derived minimum wait |
| --- | ---: |
| impressions >= 500 **or** clicks >= 20 | 14 days |
| impressions >= 100 **or** clicks >= 5 | 21 days |
| below both medium thresholds | 28 days |

The effective evaluation date is:

```text
max(persisted evaluateAfter, changedAt + derived minimum wait)
```

Configuration:

```text
KEYWORDS_OPTIMIZATION_FAST_IMPRESSIONS_7D=500
KEYWORDS_OPTIMIZATION_FAST_CLICKS_7D=20
KEYWORDS_OPTIMIZATION_MEDIUM_IMPRESSIONS_7D=100
KEYWORDS_OPTIMIZATION_MEDIUM_CLICKS_7D=5
```

These thresholds affect **wait time only**. They never determine whether a result is improved, neutral, worsened, or inconclusive. After the maximum derived wait of 28 days, the Agent may still choose `inconclusive` when the compatible evidence remains too sparse to support the persisted hypothesis.

The evaluation packet exposes `minimumWaitMatured`, traffic-adjusted `matured`, the normalized baseline traffic, traffic class, recommended wait days, persisted evaluation date, and effective evaluation date. An optimization whose persisted 14-day date has passed but whose traffic-adjusted date has not is not placed in the Agent evaluation queue.

### Autopilot evaluation handoff

The local Operator performs a bounded Sites check for linked `existing_site` projects. When an implemented/pending optimization has reached its traffic-adjusted effective evaluation date **and** a compatible GSC baseline/post pair exists, it emits:

```text
kind = evaluate_site_optimization
relatedType = site_optimization
relatedId = optimizationEvent.id
```

The ordinary Autopilot runner turns that candidate into a shared Operation; no second worker exists.

The persistent execution Agent receives two local Keywords MCP adapters backed by the same Sites command layer:

```text
site_optimization_evaluation_context
site_optimization_record_result
```

The first returns the persisted observation, diagnosis, hypothesis, evaluation-window policy, and compatible deltas. The second accepts only the semantic result, notes, and expected revision. The Agent cannot submit evaluation metric numbers: the command recomputes them from saved snapshots immediately before the optimistic Firestore update. Stored evaluation metrics also include the derived wait days and seven-day-normalized baseline clicks/impressions.

Evaluation is a measurement-only Operation. It must not edit the article or start a second optimization. If evidence is not ready, the Agent checkpoints the concrete missing evidence rather than manufacturing a verdict.

Non-actionable due checks are cached locally for `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES` (default 30) to avoid unnecessary Firestore reads. Ready work is never cached, and the cache is invalidated after result persistence and after fresh metric projection, preventing immediate duplicate scheduling.

## GSC query feedback loop

`site_query_opportunities` compares only complete, equal-length, non-overlapping site-level GSC snapshots. The snapshots retain a bounded saved top-query set, so the tool distinguishes `newly_observed_query` and `rising_query`.

`newly_observed_query` means the query is present in the current saved query set but absent from the previous saved query set. It is **not** proof that the query never existed in Search Console before. The output includes this caveat and `queryCoverage = bounded_saved_top_queries`.

The tool does not spend SERP quota and does not write Keyword Treasury. The intended handoff remains:

```text
Sites Operator site_query_opportunities
        ↓ selected query strings
Keywords Operator keyword_screen_batch       (Google Ads first)
        ↓ shortlisted only
Keywords Operator keyword_research_pipeline  (bounded SERP)
        ↓
keyword_treasury_save / Site Concept updates
```

## Cadence

- sitemap/live URL inventory: 7-day freshness threshold
- GSC measurement collection: `KEYWORDS_METRICS_CADENCE_HOURS`, default `24`
- GSC comparison windows: equal-length saved periods
- optimization due-check cache: `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES`, default `30`; ready work is not cached
- optimization evaluation: persisted minimum plus derived 14/21/28-day traffic wait; daily measurement never permits daily content changes

## Failure behavior

Cloud projection and evaluation discovery are additive and cannot invalidate locally captured evidence.

- Firestore not configured -> Sites evaluation discovery is skipped
- no `localProjectId` mapping -> Sites evaluation discovery is skipped
- GA4 saved snapshot unavailable -> GSC can still project
- Firestore projection error -> maintenance records the projection failure while retaining successful local GSC capture
- ambiguous mappings -> fail closed rather than infer identity
- no exact baseline -> evaluation stays not-ready
- traffic-adjusted wait not mature -> no evaluation Operation is created
- no compatible post period -> evaluation stays not-ready
- revision changes between read and result write -> optimistic write fails and the Agent must reread
- no compatible site GSC pair -> query-opportunity output remains empty instead of comparing overlapping windows

## Source-of-truth boundaries

```text
Git / Markdown / MDX
  -> article body + revision history

SQLite
  -> local execution, queues, runner, GSC materialization, Local UI

Firestore
  -> remote Agent control plane, site/article registry, normalized snapshots,
     optimization hypotheses and outcomes
```

No existing SQLite migration is required for this bridge.

## Next steps

1. Register real production sites with `localProjectId`.
2. Register existing Git articles with `localPageId` and/or `canonicalUrl` where article-level GSC tracking is needed.
3. Run the persistent Autopilot with Firebase/Sites credentials available so mature optimizations can enter the shared evaluation queue.
4. Let the Agent pass selected `site_query_opportunities` through Keywords Operator's Ads-first pipeline; do not directly auto-save every observed query.
5. Add direct GA4 Data API collection only if the existing analytics-dashboard acquisition path should be consolidated into this repository.
6. Consider article-level GA4 only when a trustworthy page-scoped acquisition source exists.
