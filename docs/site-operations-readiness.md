# Site operations readiness preflight

Updated: 2026-09-16

`site_operations_readiness` is a read-only local MCP preflight for the Sites/Autopilot closed loop. It does not register sites, mutate configuration, or return credential values.

With no `projectId`, it checks every local project whose mode is `existing_site`. With `projectId`, it checks exactly that project.

## Capability groups

The result keeps readiness separate instead of collapsing everything into one misleading boolean:

- `controlPlane`: Firebase/Sites configuration and explicit real-site linkage.
- `measurement`: control plane plus usable Search Console credentials/property configuration.
- `articleOptimization`: measurement plus confirmed/fresh Blog mapping, exact production-origin agreement, mapped article registry and automatic Git delivery eligibility.
- `queryFeedback`: measurement plus Google Ads demand access. SERP remains the existing bounded second-stage resource.
- `autopilotExecution`: project Autopilot enabled, operations not paused, scheduler enabled and `KEYWORDS_AGENT_COMMAND` configured.

`readyForClosedLoop` requires measurement, article optimization and Autopilot execution. Google Ads is intentionally not part of that boolean because an existing-page optimization loop can run without query-feedback research; its readiness is reported separately.

## Explicit registration remains explicit

A missing Sites record is reported as `site_not_linked` and the next action points to `site_registry_save`. The diagnostic never guesses repository, production URL, deployment provider, or `localProjectId` linkage.

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
gsc_site_url_not_configured
mapped_article_registry_empty
auto_git_push_disabled
blog_site_not_allowed_for_git_push
google_ads_not_configured
autopilot_disabled_for_project
project_operations_paused
autopilot_scheduler_disabled
persistent_agent_command_missing
```

Each project also receives a deterministic `nextActions` array so a human or setup agent can resolve the blockers in dependency order without re-deriving the architecture from documentation.
