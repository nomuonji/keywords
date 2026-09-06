# SEO Operator Skill

## Goal

Improve a project's search coverage by making small, evidence-backed, auditable changes to keywords, clusters, pages, insights, and tasks.

## Default loop

1. Read `project_snapshot`.
2. Read `opportunity_context` before opening large research payloads. It summarizes normalized Google Ads and Search Console signals into deterministic buckets.
3. Use `research_context` when you need broader workspace state, open insights, or recent evidence sources.
4. Inspect unclustered or rejected keywords before generating more.
5. Use Search Console to understand real query/page performance when configured. Imported query rows update the latest clicks, impressions, CTR, and average position stored on the keyword.
6. Use Google Ads keyword ideas when search-demand metrics can change prioritization.
7. Use SERP research for intent, competing page shapes, PAA questions, and related searches.
8. Use public web fetch only for specific pages whose contents matter to the decision.
9. Persist externally gathered evidence with `source_record` if it came from a host-native browser/search tool rather than a built-in research tool.
10. Turn evidence into explicit `insight_create` records; link them to `sourceId` when possible.
11. Prefer creating insights or tasks when evidence is incomplete.
12. Propose pages before treating them as approved work.
13. Record human approve/reject feedback as a decision.
14. Re-read the changed project state.

## Opportunity buckets

`opportunity_context` deliberately avoids a single opaque SEO score:

- `strikingDistance`: Search Console average position 4–20, ranked by impressions.
- `searchConsoleGaps`: average position worse than 20 but already receiving impressions.
- `highDemandUnclustered`: Google Ads demand exists but the keyword has no content cluster.
- `lowCompetitionDemand`: Google Ads competition <= 0.4, ranked by demand × (1 − competition).

Treat these as prioritization lenses, not automatic instructions. SERP intent and existing site coverage still decide whether a cluster/page change is justified.

## Research discipline

- Do not collect data merely because a tool exists. Research should resolve a concrete uncertainty.
- Treat Google Ads volume/competition, Search Console performance, and SERP composition as different signals; do not collapse them into one score without an explicit rule.
- Search Console impressions are first-party performance data, not market-wide search volume.
- Search Console values stored on a keyword are the latest imported observation, not a historical time series.
- Store credentials only in environment variables. Never put tokens or API keys into source metadata, insights, decisions, or tasks.
- Prefer source-backed insights over unsupported agent conclusions.

## Current constraints

- Do not publish externally.
- Do not assume a fixed content pipeline.
- Do not bypass commands by writing SQL directly.
