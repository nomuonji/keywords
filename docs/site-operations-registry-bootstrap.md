# Sites Registry Bootstrap

Updated: 2026-09-16

This addendum removes the normal manual `sites` / `articles` registration step from the local-to-cloud analytics bridge without guessing identity.

## Trigger

The existing deterministic `capture_metrics` maintenance Operation already runs:

```text
GSC capture -> SQLite -> projectSiteOperationsMetrics(projectId)
```

`projectSiteOperationsMetrics` now attempts `bootstrapSiteOperationsRegistry(projectId)` before resolving the Firestore site. There is no second scheduler and no extra Agent turn.

Bootstrap failure is additive/non-destructive. If an explicit Sites registry already exists, metric projection can continue and the bootstrap error is returned as a warning.

## Site identity

Bootstrap requires the existing `blog_bindings` row. That binding can only be created initially through the human-confirmed Blog context import, so the bootstrap does not infer a site from a project name or a nearby domain.

The following identities must agree:

```text
SQLite project.id
        <-> blog_bindings.project_id
        <-> Blog snapshot blog_site_id + canonical_origin
        <-> Blog runtime root
        <-> Git origin owner/repository
```

The Git repository is taken from the bound root's `origin` remote and only GitHub `owner/repository` forms are accepted. A legacy single-site runtime may use `KEYWORDS_SITE_REPOSITORY` as an explicit owner/repository override when a Git origin cannot be read. Multi-site workspaces should keep a real origin remote per site root rather than use a global override.

If an existing Firestore site is found by `localProjectId`, it is reused. Otherwise an exact `productionUrl` match can be linked to the local project. Conflicting project or repository identity fails closed.

A new site starts as `building` unless local live evidence exists. Complete GSC evidence or a sitemap/Search Console published page can promote a non-paused/non-archived site to `active`. Local Blog build output alone is never publication evidence.

## Article identity

Article bootstrap only considers local pages that have exactly one Blog snapshot `source_ref` for the canonical URL and whose mapped source file exists safely inside the bound Git root.

For each safe mapping:

```text
SQLite pages.id -> Firestore articles.localPageId
page.url        -> articles.canonicalUrl
source_ref      -> articles.repoPath
Git file commit -> articles.currentCommitSha
```

Existing Firestore articles are resolved by explicit `localPageId` first and exact canonical URL second. Ambiguous mappings are skipped per article instead of aborting the whole site bootstrap.

New article registry rows remain `draft` when evidence is only local. They become `published` only when the local page has sitemap/Search Console publication evidence or a page-level GSC snapshot. Existing `paused` or `archived` status is preserved.

Bootstrap never infers Treasury keyword IDs from local SQLite keyword IDs, and it does not fabricate `publishedAt`.

## Idempotency

The command compares the desired registry identity against current Firestore records before writing. Running bootstrap repeatedly with unchanged local evidence does not increment site/article revisions.

Deterministic IDs are only used for records that do not already exist. Existing exact mappings keep their IDs.

## Failure policy

The command intentionally fails or skips rather than guess when any of these occur:

- no human-confirmed Blog binding
- Blog binding/snapshot identity mismatch
- no safe GitHub repository identity
- production URL already belongs to another local project
- bound repository conflicts with the existing Sites registry
- missing/ambiguous URL-to-source mapping
- mapped source is missing or escapes the Git root
- multiple Firestore articles claim the same local page/canonical URL

Per-article failures are reported in the bootstrap result and do not prevent safe sibling articles from being registered.

## Remaining explicit metadata

Bootstrap does not invent metadata that the local operating plane cannot prove:

- `siteConceptId`
- GA4 property ID
- deployment provider for a new custom-domain site (defaults to `other`)
- article Treasury keyword IDs
- publication timestamp

Those fields can still be enriched later through the normal Sites Operator revision-controlled tools.
