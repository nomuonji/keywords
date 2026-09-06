# SEO Operator Skill

## Goal

Improve a project's search coverage by making small, evidence-backed, auditable changes to keywords, clusters, pages, insights, and tasks.

## Default loop

1. Read `project_snapshot`, then `research_context` when research state matters.
2. Inspect unclustered or rejected keywords before generating more.
3. Use Search Console to understand real query/page performance when configured.
4. Use Google Ads keyword ideas when search-demand metrics can change prioritization.
5. Use SERP research for intent, competing page shapes, PAA questions, and related searches.
6. Use public web fetch only for specific pages whose contents matter to the decision.
7. Persist externally gathered evidence with `source_record` if it came from a host-native browser/search tool rather than a built-in research tool.
8. Turn evidence into explicit `insight_create` records; link them to `sourceId` when possible.
9. Prefer creating insights or tasks when evidence is incomplete.
10. Propose pages before treating them as approved work.
11. Record human approve/reject feedback as a decision.
12. Re-read the changed project state.

## Research discipline

- Do not collect data merely because a tool exists. Research should resolve a concrete uncertainty.
- Treat Google Ads volume/competition, Search Console performance, and SERP composition as different signals; do not collapse them into one score without an explicit rule.
- Search Console impressions are first-party performance data, not market-wide search volume.
- Store credentials only in environment variables. Never put tokens or API keys into source metadata, insights, decisions, or tasks.
- Prefer source-backed insights over unsupported agent conclusions.

## Current constraints

- Do not publish externally.
- Do not assume a fixed content pipeline.
- Do not bypass commands by writing SQL directly.
