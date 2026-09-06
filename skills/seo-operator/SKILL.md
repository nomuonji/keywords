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
12. Use `cluster_bulk_assign` when several validated queries share one search intent. Do not create clusters solely from lexical similarity.
13. Read `page_cannibalization` before creating a new page when the cluster or target keyword may already be covered.
14. Use `page_plan`. Supply a primary keyword when one query clearly represents the page intent, secondary keyword IDs for close variants, a concise rationale, and relevant `sourceIds`.
15. Treat warnings returned by `page_plan` as a review requirement. A `keyword_target_overlap` warning is high risk and should normally block approval until the overlap is intentionally resolved.
16. Stop at `proposed`. Agents do not approve, reject, or override conflicts. Page review is a human action and automatically records a decision.
17. Re-read the changed project state after the human review is reflected in the workspace.

## Opportunity buckets

`opportunity_context` deliberately avoids a single opaque SEO score:

- `strikingDistance`: Search Console average position 4–20, ranked by impressions.
- `searchConsoleGaps`: average position worse than 20 but already receiving impressions.
- `highDemandUnclustered`: Google Ads demand exists but the keyword has no content cluster.
- `lowCompetitionDemand`: Google Ads competition <= 0.4, ranked by demand × (1 − competition).

Treat these as prioritization lenses, not automatic instructions. SERP intent and existing site coverage still decide whether a cluster/page change is justified.

## Page planning discipline

- A cluster represents shared search intent; a page represents one intended landing document.
- `page_plan` stores target keywords relationally in `page_keywords`, not as opaque JSON.
- Use one primary target when possible. Secondary targets should be variants that can be satisfied by the same page without changing the core intent.
- Link the evidence used for the proposal through `sourceIds`; do not paste large research payloads into the rationale.
- Keep `rationale` short and decision-oriented: why this page should exist, why it is distinct from existing pages, and which evidence changed the decision.
- `page_cannibalization` reports two separate signals: exact keyword target overlap and multiple active pages attached to the same cluster. Neither signal proves cannibalization, but both require inspection before approval.
- Do not solve overlap by inventing artificial intent differences. Merge, retarget, or archive proposals when the SERP does not support separate pages.
- Exact keyword-target overlap blocks normal human approval. A human may explicitly override only with a recorded reason.
- There is intentionally no MCP approval tool. Agent autonomy ends at the page proposal boundary for now.

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
