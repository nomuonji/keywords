# Sites Operator Analytics Storage

Updated: 2026-10-08

This document defines the current analytics and URL-state storage boundary for Sites Operator.

## Canonical architecture

There is one durable analytics projection in Firestore:

```text
Google Search Console / GA4
        ↓
ephemeral runner SQLite
        ├─ measurement_imports
        ├─ pages
        ├─ page_metric_snapshots
        ├─ query_page_metric_snapshots
        └─ keyword_metric_snapshots
        ↓
bounded aggregation
        ↓
Firestore
seoPlanningDigests/{siteId}
```

The SQLite rows are acquisition and computation state. They may be URL-level, query-level, and period-level, but they are not the durable remote analytics database.

`seoPlanningDigests/{siteId}` is overwrite-only. It contains bounded 7d/28d/90d site metrics, bounded site-query evidence, and a selected set of page signals for planning. Re-running measurement replaces the current digest instead of appending one Firestore document per URL or period.

## URL inventory and indexation are separate

Indexation uses a different durable store:

```text
sites/{siteId}/indexationUrls/{urlHash}
```

This is one mutable current-state document per URL. It is not access-analytics history.

It stores inventory/indexability and the latest Search Console URL Inspection observation, including page family, current/removed state, inspection state, canonical observations, crawl time, and the next due inspection time.

Repeated inspections overwrite the same URL document. Historical indexation trends are retained only as compact weekly site/page-family snapshots in `indexationSnapshots`.

Therefore:

- access analytics: one overwrite-only site digest;
- URL/indexation state: one mutable document per URL;
- indexation history: compact weekly aggregate snapshots;
- article bodies: Git;
- local acquisition rows: ephemeral SQLite.

## Legacy Firestore collections

Two older analytics stores may still contain historical data:

### `metricSnapshots`

This collection came from the earlier design that projected site/article period snapshots into Firestore.

It is now **read-only compatibility evidence**. Existing documents are retained because historical optimization events may still reference exact baseline/post periods.

No scheduled measurement path writes new `metricSnapshots`, and Sites Operator no longer exposes an MCP write tool for them.

`site_metric_snapshot_list` remains temporarily available for historical inspection and optimization-evidence compatibility.

### `siteDigests`

This was an older aggregate cache built on top of `metricSnapshots`.

It is deprecated. Current code neither reads nor writes it. The canonical site report is `seoPlanningDigests/{siteId}`.

Historical documents can be deleted later once no external consumer depends on them; they are not part of the current runtime contract.

## Measurement paths

Both automated acquisition paths converge on the same durable projection.

### Daily site measurement workflow

```text
site-measurement
  → sitemap/GSC/GA4 acquisition
  → ephemeral SQLite
  → refreshSeoPlanningDigest()
  → seoPlanningDigests/{siteId}
```

### Maintenance capture_metrics

```text
capture_metrics
  → GSC current/previous capture
  → GA4 current/previous capture
  → ephemeral SQLite
  → refreshSeoPlanningDigest()
  → seoPlanningDigests/{siteId}
```

The old `site-operations-bridge*` metric projection layer has been removed.

## Planning digest contents

The digest remains bounded to stay safely below Firestore document limits.

It contains:

- measurement period definitions;
- provider completeness/freshness state;
- site-level GSC metrics for 7d/28d/90d windows;
- site-level GA4 metrics when available;
- bounded site-query sets for opportunity comparison;
- selected page-level GSC and organic-GA4 signals;
- top page-query evidence for selected pages;
- counts for inventory and unobserved pages.

The page-level entries are embedded inside the single site document; they are not separate persistent URL analytics records.

## Optimization compatibility

Optimization events are durable operational records in `optimizationEvents`.

Site-level current analytics are read from `seoPlanningDigests`.

Older optimization evaluation can still read historical `metricSnapshots` when an exact historical article-level baseline/post period is needed. That path is explicitly a legacy read fallback; it does not re-enable snapshot writes.

New storage changes must not silently convert absent or partial measurements into zero.

## Source-of-truth boundaries

```text
Git
  article bodies and revision history

SQLite (ephemeral)
  raw/bounded GSC and GA4 acquisition
  URL/page/query measurement rows
  local measurement computation

Firestore current analytics
  seoPlanningDigests/{siteId}

Firestore URL state
  sites/{siteId}/indexationUrls/{urlHash}
  indexationSnapshots

Firestore operations
  sites
  articles
  optimizationEvents
  seoTasks
  siteDirections

Firestore legacy read compatibility
  metricSnapshots

Deprecated / unused
  siteDigests
```

## Invariants

1. Do not create durable Firestore access-analytics documents per URL.
2. Do not reintroduce scheduled writes to `metricSnapshots`.
3. Do not use `indexationUrls` as an analytics-history store.
4. Missing/partial observations are unknown, never zero.
5. Planner reads the compact site digest and cached indexation summaries; it does not fetch Google directly.
6. Historical compatibility must not become a second active write path.
