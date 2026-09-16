# Sites Operator Analytics Bridge

Updated: 2026-09-16

This document records the implemented measurement/projection layer used by the Agent-native SEO loop. It covers GSC and GA4 acquisition, Firestore projection, article identity synchronization, optimization evaluation, and GSC-to-Keywords feedback.

## Goal

Reuse one local scheduler/runner and one measurement contract rather than create a second analytics subsystem.

```text
existing Autopilot runner
        │
        ├─ capture_metrics
        │     ├─ GSC previous/current 7-day periods -> SQLite
        │     ├─ GA4 previous/current 7-day periods -> SQLite
        │     └─ Firestore projection
        │             ├─ confirmed Blog mapping -> article registry
        │             ├─ GSC -> metricSnapshots
        │             └─ GA4 -> metricSnapshots
        │
        ├─ due optimization check
        │     └─ evaluate_site_optimization
        │
        └─ GSC query feedback check
              └─ research_site_queries
                    └─ Ads-first bounded keyword research
```

Git remains the article-body source of truth, SQLite remains the local execution/measurement plane, and Firestore remains the remote control plane.

## Explicit identity links

Cloud records never infer local identity from names.

- `sites.localProjectId` links a local SEO project to one real site.
- `sites.productionUrl`, `repository`, and `deploymentProvider` remain explicit.
- `sites.ga4PropertyId` is the exact GA4 property identity; it is never inferred from hostname.
- `articles.localPageId` and `articles.canonicalUrl` link Firestore article records to local pages.

Duplicate or ambiguous mappings fail closed.

## Confirmed Blog article registry sync

After a real site has been explicitly registered, the bridge can reuse the already confirmed `blog_bindings` snapshot to mirror article metadata before page-level GSC projection.

The sync requires exact agreement among:

- registered `sites.productionUrl` origin;
- `blog_bindings.origin`;
- Blog snapshot `canonical_origin`.

Each `snapshot.sources[].expected_url` must resolve to exactly one local page. Mirrored metadata is limited to established identity fields such as `localPageId`, canonical URL, repository, `source_ref` as `repoPath`, title and slug.

A local build is not publication proof. Newly mirrored article records remain `draft` unless publication state has already been established through another trusted path. Existing status is preserved on metadata refresh.

Sync is bounded by `KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT`, default `100`, per projection.

## GSC acquisition

`metrics.capture` is the Search Console acquisition path. `capture_metrics` collects two equal, non-overlapping seven-day periods so later comparisons have compatible windows.

The resolver is multi-site aware. A global `GOOGLE_SEARCH_CONSOLE_SITE_URL` is optional when the project has a confirmed Blog origin or valid project domain; accessible Search Console properties can be enumerated and matched to that origin.

Each capture is written to the shared `measurement_imports` contract. Only complete imports are materialized/promoted for cloud decision state. Failed or partial observations do not overwrite the last successful materialized evidence.

Site-level GSC projection includes clicks, impressions, CTR, average position, and the bounded top query set. Article-level projection uses saved page metrics and exact article mappings. The bridge does not invent query×page data that was never collected.

## Direct GA4 acquisition

GA4 is now collected directly inside `keywords` through the Google Analytics Data API. It no longer depends on `analytics-dashboard/data/latest.json` for normal operation.

The exact property must be registered on the real site as `sites.ga4PropertyId`. Hostname-to-property guessing is deliberately not implemented.

The direct report collects site-level totals for:

```text
sessions
activeUsers
engagementRate -> normalized as engagement
screenPageViews -> normalized as views
```

The current implementation does not create article-level GA4 metrics because no trustworthy page-scoped acquisition/mapping contract has been established yet.

### GA4 credential resolution

The research layer accepts dedicated Analytics credentials first, then existing shared Google credentials:

```text
GOOGLE_ANALYTICS_ACCESS_TOKEN
GOOGLE_OAUTH_ACCESS_TOKEN
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_ANALYTICS_REFRESH_TOKEN + client credentials
GOOGLE_OAUTH_REFRESH_TOKEN + client credentials
```

The credential or service account must have Analytics read access. Secret values are not written to SQLite, source metadata, readiness output, or Firestore snapshots.

### Shared measurement contract

Direct GA4 observations are persisted as:

```text
measurement_imports.provider = ga4
property = properties/{id}
completeness = complete | failed
payload.metrics = normalized site-level metrics
```

This uses the existing versioned measurement table; no new SQLite migration is needed.

The successful source version is derived from property, period and normalized metrics. Repeated projection is therefore idempotent.

### Failure isolation

GA4 collection is additive to GSC. The maintenance sequence is:

1. persist previous GSC period;
2. persist current GSC period;
3. attempt previous/current GA4 periods;
4. project all available complete evidence to Firestore.

A missing GA4 credential, unregistered property or Data API failure does not delete or invalidate already captured GSC evidence and does not prevent GSC cloud projection.

Failed GA4 imports persist a generic failure marker rather than credential values or response bodies.

## Legacy analytics-dashboard compatibility

`KEYWORDS_ANALYTICS_FILE` remains supported as a migration fallback.

Projection policy is direct-first:

- if complete direct GA4 imports exist for the project, project those imports;
- validate their property identity against `sites.ga4PropertyId`;
- do not mix them with dashboard-derived GA4 snapshots;
- if no complete direct GA4 import exists, the bridge may use the legacy saved dashboard snapshot.

The fallback can therefore be removed later without changing the Firestore `metricSnapshots` contract.

## Firestore projection

All normalized metrics are saved through the existing metric snapshot write path, keeping projection idempotent by source version.

The bridge fails closed when a registered property does not match the persisted observation. Fresh metric projection invalidates the optimization-due and query-feedback probe caches so newly available evidence can enter the existing runner.

## Optimization evaluation evidence

Optimization evaluation remains GSC-driven because current optimization hypotheses concern organic search performance and article-level GA4 is not yet available.

The evaluation context requires compatible complete article-level GSC periods. The baseline/post periods must be equal length and the post period must occur after the implemented change.

The command returns metric deltas but never invents the semantic verdict. The Agent records one of `improved`, `neutral`, `worsened`, or `inconclusive` after comparing persisted evidence to the persisted hypothesis.

### Traffic-aware minimum wait

The persisted `optimizationEvent.evaluateAfter` is a hard minimum. Traffic policy may extend it:

| baseline traffic normalized to 7 days | derived minimum wait |
| --- | ---: |
| impressions >= 500 or clicks >= 20 | 14 days |
| impressions >= 100 or clicks >= 5 | 21 days |
| below both medium thresholds | 28 days |

Configuration:

```text
KEYWORDS_OPTIMIZATION_FAST_IMPRESSIONS_7D=500
KEYWORDS_OPTIMIZATION_FAST_CLICKS_7D=20
KEYWORDS_OPTIMIZATION_MEDIUM_IMPRESSIONS_7D=100
KEYWORDS_OPTIMIZATION_MEDIUM_CLICKS_7D=5
```

These thresholds change wait time only, never the result label.

## GSC query feedback loop

Complete compatible site-level GSC snapshots feed the low-priority `research_site_queries` Operation.

The pinned candidate batch follows:

```text
GSC candidate queries
        ↓
Google Ads demand (proxy first)
        ↓ proxy failure only
direct Ads fallback
        ↓
deterministic screening
        ↓ passing shortlist only
bounded cached SERP
        ↓
Agent selection
        ↓
Keyword Treasury
```

SERP checks remain hard-bounded by `KEYWORDS_SITE_QUERY_MAX_SERP_CHECKS`; GSC queries are not dumped automatically into Treasury. Saved candidates preserve GSC provenance.

## Cadence

- sitemap/live URL inventory: 7-day freshness threshold;
- GSC/GA4 measurement scheduling: `KEYWORDS_METRICS_CADENCE_HOURS`, default `24`;
- each maintenance measurement run compares equal seven-day periods;
- Blog article registry sync occurs immediately before cloud metric projection;
- optimization due-check cache: `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES`, default `30`;
- optimization evaluation wait: persisted minimum plus derived 14/21/28-day policy;
- query-feedback non-ready cache: `KEYWORDS_SITE_QUERY_FEEDBACK_CHECK_MINUTES`, default `60`.

## Failure behavior

The bridge is deliberately additive and fail-closed:

- Firestore not configured -> local GSC evidence still persists; Sites projection is skipped;
- real site not linked -> cloud projection is skipped rather than guessing;
- confirmed Blog binding absent -> article sync is skipped; explicit existing article mappings can still be used;
- Blog/registered origins disagree -> automatic article sync is rejected;
- article identity is ambiguous -> page-level projection skips that article;
- GSC capture fails/partial -> prior successful materialized evidence is preserved;
- GA4 credentials missing -> GA4 is skipped, GSC continues;
- GA4 property missing -> GA4 is skipped, property is never inferred;
- GA4 Data API fails -> failed observation is recorded generically, GSC continues;
- GA4 observation property differs from Sites registry -> snapshot is not projected;
- Firestore projection fails -> successful local acquisitions remain persisted;
- no exact optimization baseline/post pair -> evaluation remains not-ready;
- Ads routes fail -> SERP is not used as fake demand evidence;
- SERP quota/reserve is reached -> research stops rather than bypassing the limit.

## Source-of-truth boundaries

```text
Git / Markdown / MDX
  -> article body + revision history

SQLite
  -> runner, Operations, queues, GSC/GA4 measurement imports,
     materialized GSC page/query state, local observability

Firestore
  -> real-site/article registry, normalized metricSnapshots,
     optimization hypotheses/outcomes, Keyword Treasury, Site Concepts
```

## Operational prerequisites for a real site

For full search + behavior analytics operation, configure each site explicitly:

1. register the real site with `localProjectId`, repository, production URL and deployment provider;
2. register `ga4PropertyId` when GA4 is desired;
3. confirm/refresh the Blog binding for automatic article mapping and delivery;
4. provide Search Console credentials and a resolvable site scope;
5. provide Analytics Data API credentials with access to the registered GA4 property;
6. provide Google Ads access only when the GSC-query feedback research loop is desired;
7. enable Autopilot, scheduler, persistent Agent command and verified Git delivery as appropriate.

`site_operations_readiness` reports these requirements separately as `measurement`, `behaviorAnalytics`, `articleOptimization`, `queryFeedback`, and `autopilotExecution` capabilities.

## Remaining work

1. Register actual production sites and their GA4 properties explicitly; no automatic deployment/property guessing is planned.
2. Run real credential-backed GSC + GA4 maintenance against at least one production site and verify resulting Firestore snapshots end to end.
3. Consider article-level GA4 only after a trustworthy page-scoped acquisition and canonical mapping contract exists.
4. Remove the legacy analytics-dashboard fallback only after all active sites have direct GA4 imports.
5. Consolidate the separate Vercel `/mcp` Ads/provider wrapper later if serverless bundling can preserve the production contract cleanly.
