# AGENTS.md

## Product principle

This repository is an agent-native SEO workspace. Do not add a second, agent-only state model. Human UI actions, CLI operations, and MCP tool calls must execute the same commands against the same SQL database.

## Boundaries

1. `packages/db` owns persistence and schema.
2. `packages/research` owns external read adapters and must not mutate workspace state.
3. `packages/commands` owns mutations and business rules, including persistence of research results.
4. `apps/api`, `apps/cli`, `apps/mcp`, and `apps/web` are adapters.
5. Adapters must not write SQL directly.
6. Every mutating command must produce a `runs` audit record.
7. Agent work should be grouped into `work_sessions` whenever the user asks the agent to perform a body of SEO work rather than one isolated read/write.
8. A work session stores objective, completion criteria, bounded action budget, checkpoints, command linkage, and a final project-state diff. Checkpoints store concise outcomes and next actions, never private chain-of-thought.
9. Concrete human decisions requested by an agent belong in `review_requests`. A review request pauses its work session and exposes explicit resolution options in the Human Review Inbox.
10. Human approve/reject choices that teach future behavior belong in `decisions`.
11. Durable project-specific operating rules belong in `policy_rules`. Agents may propose candidates from decisions, but only humans may activate, reject, or retire them.
12. Active project policies take precedence over generic SEO heuristics in `skills/`, unless a higher-level product/safety boundary conflicts with them.
13. Research credentials are environment-only; never write access tokens, API keys, developer tokens, or OAuth secrets to SQLite, source metadata, runs, decisions, policy rules, work sessions, checkpoints, or review requests.
14. Publishing is intentionally not implemented yet. Do not add WordPress, Hatena, Blogger, or CMS credentials.

## Agent safety model

- Read operations: allowed without approval.
- Reversible workspace writes: allowed when requested.
- External research reads: allowed when configured, and should persist useful evidence as a `source`.
- Page proposals: agents may create evidence-backed `page_plan` records but may not approve them.
- Policy learning: agents may call `policy_context` and propose decision-backed policy candidates, but may not activate or retire policies.
- Human review: agents may create and inspect `review_requests`, but there is intentionally no MCP tool for resolving them.
- Work-session pause states are real boundaries. When a session is `awaiting_review` or `blocked`, do not continue writes or external research until the condition is resolved and the session is resumed/synchronized.
- Respect the work-session action budget. Read-only inspection does not consume the action budget; workspace mutations and external research do. When exhausted, checkpoint, request review, or complete instead of expanding scope.
- Destructive or external side effects: design an approval boundary first.
- Public web fetches must reject local/private-network targets by default.

## Preferred work loop

For a substantial user instruction such as "do today's SEO work":

1. Call `work_context` to read the compact operating state.
2. If no unfinished session exists, call `work_start`. Prefer the deterministic recommended focus unless the user's instruction gives a more specific objective.
3. Read active project policies before making strategy choices.
4. Claim or move a selected task to `doing` when the session is task-driven.
5. Gather only evidence that can change the decision.
6. Make the smallest justified structured changes through commands.
7. Use `work_checkpoint` after a meaningful phase or when blocked.
8. When a specific human choice is required, call `review_request` with the target, question, and explicit options. This automatically moves the session to `awaiting_review`; do not also create a vague duplicate checkpoint.
9. Stop rather than continuing speculative work across that approval boundary.
10. After the human resolves the request, call `work_context` to synchronize the session and continue only if it is running.
11. Call `work_complete` with a concise outcome summary when the completion criteria are satisfied. The system records the baseline-to-current state diff automatically.

Do not use checkpoint or review-request text as a scratchpad. Record results, evidence-backed conclusions, blockers, the concrete human question, and the next externally useful action only.

When repeated human decisions indicate a durable preference, use their decision IDs to propose a concise project policy candidate. Do not infer a permanent rule from a single incidental judgment unless the human explicitly states it as a general rule. Avoid hard-coded A→B→C pipelines when a command-based loop can express the workflow.
