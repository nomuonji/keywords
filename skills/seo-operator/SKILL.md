# SEO Operator Skill

## Goal

Improve a project's search coverage by making small, evidence-backed, auditable changes to keywords, clusters, pages, insights, and tasks while respecting durable project-specific rules learned from human decisions.

## Session-first workflow

For any substantial instruction such as "do today's SEO work", operate inside a work session.

1. Call `work_context` first. It is the compact bootstrap view and includes the current session, active policies, prioritized agent tasks, review queue, open insights, normalized opportunities, and a deterministic next-focus hint.
2. If there is no unfinished session, call `work_start`. Use the user's explicit objective when provided; otherwise prefer the focus suggested by `work_context`.
3. Respect the session's completion criteria and action budget. Do not expand the objective merely because more possible work exists.
4. If the session is task-driven, move the selected task to `doing` before substantive work and to `review`/`done` when appropriate.
5. Gather only evidence that can change the current decision.
6. Make the smallest justified structured changes through MCP commands.
7. After a meaningful phase, call `work_checkpoint` with a concise result summary and next action. Do not record private chain-of-thought.
8. If a human decision is required, checkpoint as `awaiting_review` and stop. Do not continue speculative writes or external research across that boundary.
9. If blocked by missing data, credentials, or another external condition, checkpoint as `blocked` with the specific blocker and next externally useful action.
10. Resume only after the blocking/review condition changed.
11. When the completion criteria are satisfied, call `work_complete`. The system records the baseline-to-current project-state diff automatically.

## Strategy loop inside a session

1. Apply `work_context.activePolicies` as project-specific constraints. Use `policy_context` when you need decision history or candidate details.
2. Use the compact opportunity buckets before opening large research payloads.
3. Inspect unclustered or rejected keywords before generating more.
4. Use Search Console to understand real query/page performance when configured. Imported query rows update the latest clicks, impressions, CTR, and average position stored on the keyword.
5. Use Google Ads keyword ideas when search-demand metrics can change prioritization.
6. Use SERP research for intent, competing page shapes, PAA questions, and related searches.
7. Use public web fetch only for specific pages whose contents matter to the decision.
8. Persist externally gathered evidence with `source_record` if it came from a host-native browser/search tool rather than a built-in research tool.
9. Turn evidence into explicit `insight_create` records; link them to `sourceId` when possible.
10. Prefer creating insights or tasks when evidence is incomplete.
11. Use `cluster_bulk_assign` when several validated queries share one search intent. Do not create clusters solely from lexical similarity.
12. Read `page_cannibalization` before creating a new page when the cluster or target keyword may already be covered.
13. Use `page_plan`. Supply a primary keyword when one query clearly represents the page intent, secondary keyword IDs for close variants, a concise rationale, and relevant `sourceIds`.
14. Treat warnings returned by `page_plan` as a review requirement. A `keyword_target_overlap` warning is high risk and should normally block approval until the overlap is intentionally resolved.
15. Stop at `proposed`. Agents do not approve, reject, or override conflicts. Page review is a human action and automatically records a decision.
16. After meaningful human decisions accumulate, re-read `policy_context`. If a repeated pattern expresses a durable preference not already covered by an active/candidate policy, use `policy_propose` with the exact source decision IDs.

## Work-session discipline

- A work session is an execution envelope, not a hidden scratchpad.
- `objective` describes the bounded job being done now.
- `completionCriteria` define when to stop.
- `maxActions` is a scope/cost control. When the remaining budget reaches zero, checkpoint or complete instead of starting more work.
- Checkpoints contain outcomes, blockers, evidence-backed conclusions, and the next externally useful action only.
- `awaiting_review` and `blocked` are real pause states. Do not bypass them with another write tool.
- A final session summary should say what changed, what did not change, and whether anything remains for human review. Do not include internal reasoning traces.

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

`opportunity_context` and `work_context` deliberately avoid a single opaque SEO score:

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
- Store credentials only in environment variables. Never put tokens or API keys into source metadata, insights, decisions, tasks, policy rules, work sessions, or checkpoints.
- Prefer source-backed insights over unsupported agent conclusions.

## Current constraints

- Do not publish externally.
- Do not assume a fixed content pipeline.
- Do not bypass commands by writing SQL directly.
