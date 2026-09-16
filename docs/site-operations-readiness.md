# Site operations readiness preflight

Updated: 2026-09-16

`site_operations_readiness` is a read-only local MCP preflight for the Sites/Autopilot closed loop. It does not register sites, mutate configuration, or return credential values.

With no `projectId`, it checks every local project whose mode is `existing_site`. With `projectId`, it checks exactly that project.

## Capability groups

The result keeps readiness separate instead of collapsing everything into one misleading boolean:

- `controlPlane`: Firebase/Sites configuration and explicit real-site linkage.
- `measurement`: control plane plus usable Search Console credentials and a resolvable project/property scope.
- `behaviorAnalytics`: control plane plus direct GA4 Data API credentials and an explicitly registered `sites.ga4PropertyId`.
- `articleOptimization`: measurement plus confirmed/fresh Blog mapping, exact production-origin agreement, mapped article registry and automatic Git delivery eligibility.
- `queryFeedback`: measurement plus Google Ads demand access. SERP remains the existing bounded second-stage resource.
- `autopilotExecution`: project Autopilot enabled, operations not paused, scheduler enabled and `KEYWORDS_AGENT_COMMAND` configured.

`readyForClosedLoop` requires Search Console measurement, article optimization and Autopilot execution. GA4 and Google Ads are intentionally not required for that existing-page SEO loop.

`readyForFullAnalyticsClosedLoop` additionally requires `behaviorAnalytics`, meaning the same project can collect both search-performance evidence and direct GA4 site-level behavior metrics without depending on the legacy dashboard snapshot.

## Multi-site Search Console scope

`GOOGLE_SEARCH_CONSOLE_SITE_URL` is not a required per-process singleton for the multi-site worker. The existing `resolveGscProperty` command behaves as follows:

1. use an explicitly requested property when it covers the project origin;
2. otherwise use `GOOGLE_SEARCH_CONSOLE_SITE_URL` when that configured property covers the project origin;
3. otherwise, when the project has a confirmed Blog origin or valid project domain, enumerate accessible Search Console properties and select one that covers that origin.

The readiness preflight therefore reports `gscPropertyDiscoveryAvailable` and treats the global property env as optional when an origin exists. `gsc_property_scope_unresolvable` is emitted only when neither a configured property nor a valid project origin is available. Search Console credentials are still required.

## Direct GA4 identity and credentials

GA4 does not use hostname-based property discovery. A real site must have its exact GA4 property recorded in `sites.ga4PropertyId`; the runtime never guesses a property from `productionUrl`.

Credential detection supports, in priority order:

- `GOOGLE_ANALYTICS_ACCESS_TOKEN`;
- `GOOGLE_OAUTH_ACCESS_TOKEN`;
- `GOOGLE_APPLICATION_CREDENTIALS`;
- `GOOGLE_ANALYTICS_REFRESH_TOKEN` + client credentials;
- shared `GOOGLE_OAUTH_REFRESH_TOKEN` + client credentials.

The underlying OAuth grant/service account must actually have Analytics read access. The preflight reports configuration presence only; it does not make a live token or Data API call.

## Explicit registration remains explicit

A missing Sites record is reported as `site_not_linked` and the next action points to `site_registry_save`. The diagnostic never guesses repository, production URL, deployment provider, `localProjectId`, Search Console property, or GA4 property linkage.

After a site is registered, a confirmed Blog binding can continue to feed the existing article-registry synchronization before metric projection. The preflight reports an empty mapped article registry until that synchronization has real metadata to project.

## Safety and observability

The tool returns booleans and blocker codes, not secret values. In particular it does not expose service-account JSON, OAuth tokens, API keys, `KEYWORDS_AGENT_COMMAND`, or Git credentials.

Typical blocker codes include:

```text
firebase_project_not_configured
firebase_service_account_not_configured
site_not_linked
blog_binding_missing
blog_binding_stale
blog_site_origin_mismatch
gsc_credentials_not_configured
gsc_property_scope_unresolvable
ga4_credentials_not_configured
ga4_property_not_registered
mapped_article_registry_empty
auto_git_push_disabled
blog_site_not_allowed_for_git_push
google_ads_not_configured
autopilot_disabled_for_project
project_operations_paused
autopilot_scheduler_disabled
persistent_agent_command_missing
```

Each project also receives a deterministic `nextActions` array so a human or setup agent can resolve blockers in dependency order without re-deriving the architecture from documentation.
