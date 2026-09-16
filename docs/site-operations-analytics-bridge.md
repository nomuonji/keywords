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
        │     ├─ GA4 totals + bounded landingPage rows -> SQLite
        │     └─ Firestore projection
        │             ├─ confirmed Blog mapping -> article registry
        │             ├─ GSC site/article -> metricSnapshots
        │             └─ GA4 site/article -> metricSnapshots
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

After a real site has been explicitly registered, the bridge can reuse the already confirmed `blog_bindings` snapshot to mirror article metadata before page-level metric projection.

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

GA4 is collected directly inside `keywords` through the Google Analytics Data API. It no longer depends on `analytics-dashboard/data/latest.json` for normal operation.

The exact property must be registered as `sites.ga4PropertyId`. Hostname-to-property guessing is deliberately not implemented.

Each period performs two bounded reports:

```text
site totals:
  sessions
  activeUsers
  engagementRate -> engagement
  screenPageViews -> views

landing-page rows:
  landingPage
  + the same four metrics
```

`KEYWORDS_GA4_LANDING_PAGE_LIMIT` defaults to `25000` and is capped at `250000`. One bounded Data API request is used per period; if Google reports more rows than were returned, the landing-page set is marked partial rather than silently treated as complete.

### Exact article mapping

Article-level GA4 is projected only from a **complete** landing-page set.

The mapping is deterministic:

```text
registered production origin
        +
GA4 landingPage path
        ↓
normalized canonical URL
        ↓ exact match
articles.canonicalUrl
```

The mapper accepts only an origin-relative path beginning with a single `/`. Protocol-relative values, foreign origins, malformed paths, and unmapped URLs are rejected. Query parameters are not used for identity; trailing slash normalization matches the existing article canonical-key rule.

If multiple GA4 landing paths collapse onto the same normalized article identity, that article is skipped for the period. In particular, `activeUsers` is not naively summed across overlapping rows.

The legacy analytics-dashboard fallback remains site-level only and never fabricates article metrics.

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

Direct GA4 observations remain in the existing versioned table:

```text
measurement_imports.provider = ga4
property = properties/{id}
completeness = complete | failed
payload.metrics = normalized site totals
payload.landingPages = {
  status: complete | partial | failed,
  rowCount,
  rows
}
```

The overall observation can be complete for site totals while the landing-page sub-observation is partial/failed. This distinction lets site-level analytics continue without incorrectly promoting incomplete article evidence.

No SQLite migration is required.

### Failure isolation

GA4 collection is additive to GSC. The maintenance sequence is:

1. persist previous GSC period;
2. persist current GSC period;
3. attempt previous/current GA4 periods;
4. within each successful GA4 site-total capture, attempt bounded landing-page collection;
5. project all trustworthy evidence to Firestore.

A landing-page failure does not invalidate its site-level GA4 total. A full GA4 failure does not delete or invalidate already captured GSC evidence and does not prevent GSC cloud projection.

Failed provider observations store generic failure markers rather than credential values or response bodies.

## Legacy analytics-dashboard compatibility

`KEYWORDS_ANALYTICS_FILE` remains supported as a migration fallback.

Projection policy is direct-first:

- if complete direct GA4 imports exist, project those imports;
- validate property identity against `sites.ga4PropertyId`;
- project article GA4 only from complete direct landing-page evidence;
- do not mix direct and dashboard-derived GA4 in one pass;
- if no complete direct GA4 import exists, the bridge may use the legacy saved dashboard snapshot at site level only.

The fallback can therefore be removed later without changing the Firestore `metricSnapshots` contract.

## Firestore projection

All normalized metrics are saved through the existing metric snapshot path, keeping projection idempotent by source version.

A direct site-level snapshot has `articleId = null`. An exact landing-page match creates a separate GA4 snapshot with the registered article ID. Therefore existing `optimizationContext(articleId)` can expose `latestMetrics.ga4` without a special side channel or a changed MCP contract.

The bridge fails closed when property identity does not match or article mapping is ambiguous. Fresh projection invalidates optimization-due and query-feedback probe caches so newly available evidence can enter the existing runner.

## Optimization evaluation evidence

The optimization trigger and formal before/after result remain GSC-driven because the persisted optimization policy currently evaluates organic search hypotheses against compatible article-level GSC windows.

Article-level GA4 is now additional diagnosis/context evidence. The Agent can inspect sessions, active users, engagement and views for the exact mapped article, but the system does not automatically convert those signals into an `improved`/`worsened` verdict or substitute them for the persisted GSC baseline.

The GSC evaluation context requires compatible complete article-level periods. The baseline/post periods must be equal length and the post period must occur after the implemented change.

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
- GA4 landing-page row limit: `KEYWORDS_GA4_LANDING_PAGE_LIMIT`, default `25000`;
- each maintenance measurement run compares equal seven-day periods;
- Blog article registry sync occurs immediately before cloud metric projection;
- optimization due-check cache: `KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES`, default `30`;
- optimization evaluation wait: persisted minimum plus derived 14/21/28-day policy;
- query-feedback non-ready cache: `KEYWORDS_SITE_QUERY_FEEDBACK_CHECK_MINUTES`, default `60`.

## Failure behavior

The bridge is deliberately additive and fail-closed:

- Firestore not configured -> local evidence still persists; Sites projection is skipped;
- real site not linked -> cloud projection is skipped rather than guessing;
- confirmed Blog binding absent -> article sync is skipped; explicit article mappings can still be used;
- Blog/registered origins disagree -> automatic article sync is rejected;
- article identity is ambiguous -> article-level projection skips that article;
- GSC capture fails/partial -> prior successful materialized evidence is preserved;
- GA4 credentials missing -> GA4 is skipped, GSC continues;
- GA4 property missing -> GA4 is skipped, property is never inferred;
- GA4 site-total request fails -> generic failed observation; GSC continues;
- GA4 landing request fails/partial -> site GA4 persists; no article GA4 is promoted for that period;
- GA4 landing path does not exactly match a registered article -> row remains unprojected;
- multiple landing rows collapse to one normalized article -> that article is skipped rather than aggregating unique-user metrics incorrectly;
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
  -> real-site/article registry, site/article metricSnapshots,
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
2. Run real credential-backed GSC + GA4 maintenance against at least one production site and verify site/article Firestore snapshots end to end.
3. Decide later whether specific optimization hypothesis types should incorporate compatible article-level GA4 deltas into formal evaluation; do not broaden verdict semantics implicitly.
4. Remove the legacy analytics-dashboard fallback only after all active sites have direct GA4 imports.
5. Consolidate the separate Vercel `/mcp` Ads/provider wrapper later if serverless bundling can preserve the production contract cleanly.
