# SEO Operator Skill

## Goal

Improve a project's search coverage by making small, evidence-backed, auditable changes to keywords, clusters, pages, insights, and tasks while respecting durable project-specific rules learned from human decisions.

## Default loop

1. Read `project_snapshot`.
2. Read `policy_context`. Apply all active project rules as operating constraints. Inspect repeated decision patterns and pending candidates before making strategy choices.
3. Read `opportunity_context` before opening large research payloads. It summarizes normalized Google Ads and Search Console signals into deterministic buckets.
4. Use `research_context` when you need broader workspace state, open insights, or recent evidence sources.
5. Inspect unclustered or rejected keywords before generating more.
6. Use Search Console to understand real query/page performance when configured. Imported query rows update the latest clicks, impressions, CTR, and average position stored on the keyword.
7. Use Google Ads keyword ideas when search-demand metrics can change prioritization.
8. Use SERP research for intent, competing page shapes, PAA questions, and related searches.
9. Use public web fetch only for specific pages whose contents matter to the decision.
10. Persist externally gathered evidence with `source_record` if it came from a host-native browser/search tool rather than a built-in research tool.
11. Turn evidence into explicit `insight_create` records; link them to `sourceId` when possible.
12. Prefer creating insights or tasks when evidence is incomplete.
13. Use `cluster_bulk_assign` when several validated queries share one search intent. Do not create clusters solely from lexical similarity.
14. Read `page_cannibalization` before creating a new page when the cluster or target keyword may already be covered.
15. Use `page_plan`. Supply a primary keyword when one query clearly represents the page intent, secondary keyword IDs for close variants, a concise rationale, and relevant `sourceIds`.
16. Treat warnings returned by `page_plan` as a review requirement. A `keyword_target_overlap` warning is high risk and should normally block approval until the overlap is intentionally resolved.
17. Stop at `proposed`. Agents do not approve, reject, or override conflicts. Page review is a human action and automatically records a decision.
18. After meaningful human decisions accumulate, re-read `policy_context`. If a repeated pattern expresses a durable preference not already covered by an active/candidate policy, use `policy_propose` with the exact source decision IDs.
19. Re-read project and policy state after human reviews are reflected in the workspace.

## Policy memory discipline

- `decisions` are event-level judgments; `policy_rules` are durable operating guidance. Do not treat every decision as a permanent rule.
- `policy_context.active` is authoritative project guidance until a human retires it.
- `policy_context.decisionPatterns` groups repeated decisions by action, target type, and verdict. The grouping is only a signal that a pattern exists; inspect the reasons before proposing a semantic rule.
- Prefer proposing a policy from multiple consistent human decisions. A single decision is appropriate only when the human explicitly expressed a general rule.
- A candidate policy must cite `sourceDecisionIds`. Keep the rule concise, actionable, and scoped (`page_strategy`, `clustering`, `research`, `prioritization`, or another clear scope).
- Do not create policy candidates that merely restate metrics or one-off facts.
- Do not activate, reject, or retire policies. Those are human-only operations.
- If an active policy conflicts with new evidence, surface the conflict as an insight/task or propose a replacement candidate; do not silently ignore the active policy.

## Opportunity buckets

`opportunity_context` deliberately avoids a single opaque SEO score:

- `strikingDistance`: Search Console average position 4–20, ranked by impressions.
- `searchConsoleGaps`: average position worse than 20 but already receiving impressions.
- `highDemandUnclustered`: Google Ads demand exists but the keyword has no content cluster.
- `lowCompetitionDemand`: Google Ads competition <= 0.4, ranked by demand × (1 − competition).

Treat these as prioritization lenses, not automatic instructions. SERP intent, active project policies, and existing site coverage still decide whether a cluster/page change is justified.

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
- Store credentials only in environment variables. Never put tokens or API keys into source metadata, insights, decisions, tasks, or policy rules.
- Prefer source-backed insights over unsupported agent conclusions.

## Current constraints

- Do not publish externally.
- Do not assume a fixed content pipeline.
- Do not bypass commands by writing SQL directly.
