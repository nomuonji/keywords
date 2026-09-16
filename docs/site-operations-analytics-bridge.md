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

Site-level snapshots include:

```text
clicks
impressions
ctr
averagePosition
queries (top 200 by impressions)
```

Article-level snapshots include the page-level GSC metrics already materialized in SQLite. The bridge does not fabricate query×page rows when the local capture did not collect that dimension.

All writes use `site_metric_snapshot_save`, so repeated projection of the same source version is idempotent.

## GA4 flow

Direct GA4 Data API collection is not yet duplicated inside `keywords`.

The repository already reads the persisted `analytics-dashboard/data/latest.json` snapshot. The bridge reuses that observation source and projects its current/previous site-level GA4 totals into Firestore:

```text
sessions
activeUsers
engagement
views
```

This is deliberately **saved GA4 snapshot projection**, not direct GA4 API integration in `keywords`.

Article-level GA4 is not created because the current saved dashboard source is site-level only.

## Optimization evaluation evidence

`optimization_evaluation_context` is deliberately read-only. It finds one persisted optimization event and builds a compatible before/after GSC evidence packet.

The comparison requires:

```text
baseline snapshot
  = complete article-level GSC
  = exact optimizationEvent.baselinePeriod

post snapshot
  = complete article-level GSC
  = same period length as baseline
  = period starts after the change date
  = period reaches/passes evaluateAfter
```

The tool returns absolute/relative deltas for:

```text
clicks
impressions
ctr
averagePosition
```

It **does not automatically label the result improved/neutral/worsened**. The hypothesis is semantic and already persisted in `optimizationEvents`; the Agent compares the compatible deltas to that hypothesis and records the result only after the wait has matured.

### Autopilot evaluation handoff

The local Operator now performs a bounded Sites check for linked `existing_site` projects. When an implemented/pending optimization has reached `evaluateAfter` **and** a compatible GSC baseline/post pair exists, it emits:

```text
kind = evaluate_site_optimization
relatedType = site_optimization
relatedId = optimizationEvent.id
```

The ordinary Autopilot runner turns that candidate into a shared Operation. It does not create a second worker.

The persistent execution Agent receives two local Keywords MCP adapters backed by the same Sites command layer:

```text
site_optimization_evaluation_context
site_optimization_record_result
```

The first returns the persisted observation, diagnosis, hypothesis and compatible deltas. The second accepts only:

```text
result = improved | neutral | worsened | inconclusive
notes
expectedRevision
```

The Agent cannot submit evaluation metric numbers. `site_optimization_record_result` recomputes those numbers from the saved snapshots immediately before the optimistic write, then records them in `optimizationEvents.evaluationMetrics`. This prevents invented or stale metric values from being persisted.

Evaluation is a measurement-only Operation: it must not edit the article or start a second optimization. If evidence is not ready, the Agent checkpoints the concrete missing evidence rather than manufacturing a verdict.

Non-actionable due checks are cached locally for `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES` (default 30) to avoid unnecessary Firestore reads. Ready work is never cached, and the cache is invalidated after result persistence and after fresh metric projection, preventing immediate duplicate scheduling.

This preserves the one-change/one-hypothesis boundary and prevents a generic metric rule from silently redefining the experiment after publication.

## GSC query feedback loop

`site_query_opportunities` compares only complete, equal-length, non-overlapping **site-level** GSC snapshots. The snapshots retain a bounded saved top-query set, so the tool distinguishes:

```text
newly_observed_query
rising_query
```

`newly_observed_query` means the query is present in the current saved query set but absent from the previous saved query set. It is **not** proof that the query never existed in Search Console before. The output includes this caveat and `queryCoverage = bounded_saved_top_queries`.

Candidates use configurable minimum impressions and impression-growth ratio.

The tool does not spend SERP quota and does not write Keyword Treasury. The intended handoff is:

```text
Sites Operator site_query_opportunities
        ↓ selected query strings
Keywords Operator keyword_screen_batch       (Google Ads first)
        ↓ shortlisted only
Keywords Operator keyword_research_pipeline  (bounded SERP)
        ↓
keyword_treasury_save / Site Concept updates
```

This preserves the existing SERP budget and ownership boundary instead of allowing the operations side to bypass research policy.

## Cadence

The existing Operator remains responsible for scheduling.

- sitemap/live URL inventory: 7-day freshness threshold
- GSC measurement collection: `KEYWORDS_METRICS_CADENCE_HOURS`, default `24`
- comparison windows: still seven-day periods, so daily capture refreshes evidence without changing the statistical comparison unit
- optimization due-check cache: `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES`, default `30`; ready work is not cached
- optimization evaluation: controlled by `optimizationEvents.evaluateAfter`; daily measurement does not permit daily content changes

## Failure behavior

Cloud projection and evaluation discovery are additive and cannot invalidate locally captured evidence.

- Firestore not configured -> Sites evaluation discovery is skipped
- no `localProjectId` mapping -> Sites evaluation discovery is skipped
- GA4 saved snapshot unavailable -> GSC can still project
- Firestore projection error -> maintenance records the projection failure while retaining successful local GSC capture
- ambiguous mappings -> fail closed rather than infer identity
- no exact baseline / compatible post period -> evaluation context remains not-ready instead of manufacturing a verdict
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
5. Add a traffic-aware evaluation-window policy for low-sample articles instead of forcing every experiment to resolve after 14 days.
6. Add direct GA4 Data API collection only if the existing analytics-dashboard acquisition path should be consolidated into this repository.
7. Consider article-level GA4 only when a trustworthy page-scoped acquisition source exists.
