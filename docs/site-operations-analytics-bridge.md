# Sites Operator Analytics Bridge

Updated: 2026-09-16

This document is the implementation addendum to `site-operations-architecture.md`. It records the first implemented part of that document's analytics migration phase.

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
        └─ later optimization evaluation
```

The bridge is a projection layer. It does not change the canonical ownership of article bodies, local execution state, or raw measurement acquisition.

## Explicit identity links

Cloud records no longer need to infer local identity from names.

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

`capture_metrics` still captures two equal, non-overlapping seven-day periods. After those observations have been materialized locally, the maintenance worker calls the projection bridge.

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

This is deliberately described as **saved GA4 snapshot projection**, not direct GA4 API integration in `keywords`.

Article-level GA4 is not created because the current saved dashboard source is site-level only.

## Cadence

The existing Operator remains responsible for scheduling.

- sitemap/live URL inventory: 7-day freshness threshold
- GSC measurement collection: `KEYWORDS_METRICS_CADENCE_HOURS`, default `24`
- comparison windows: still seven-day periods, so daily capture refreshes evidence without changing the statistical comparison unit
- optimization evaluation: still controlled by `optimizationEvents.evaluateAfter`; daily measurement does not permit daily content changes

## Failure behavior

Cloud projection is additive and cannot invalidate locally captured evidence.

- Firestore not configured -> projection is skipped
- no `localProjectId` mapping -> projection is skipped with a setup hint
- GA4 saved snapshot unavailable -> GSC can still project
- Firestore projection error -> maintenance records the projection failure in its result while retaining successful local GSC capture
- ambiguous mappings -> fail closed rather than infer identity

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
3. Add direct GA4 Data API collection only if the existing analytics-dashboard acquisition path should be consolidated into this repository.
4. Implement deterministic optimization-event evaluation from mature before/after snapshots.
5. Feed genuinely new GSC queries back through Keywords Operator's Treasury -> Google Ads -> bounded SERP pipeline.
