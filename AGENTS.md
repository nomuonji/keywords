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
7. Human approve/reject choices that teach future behavior belong in `decisions`.
8. Durable project-specific operating rules belong in `policy_rules`. Agents may propose candidates from decisions, but only humans may activate, reject, or retire them.
9. Research credentials are environment-only; never write access tokens, API keys, developer tokens, or OAuth secrets to SQLite, source metadata, runs, decisions, or policy rules.
10. Publishing is intentionally not implemented yet. Do not add WordPress, Hatena, Blogger, or CMS credentials.

## Agent safety model

- Read operations: allowed without approval.
- Reversible workspace writes: allowed when requested.
- External research reads: allowed when configured, and should persist useful evidence as a `source`.
- Page proposals: agents may create evidence-backed `page_plan` records but may not approve them.
- Policy learning: agents may call `policy_context` and propose decision-backed policy candidates, but may not activate or retire policies.
- Destructive or external side effects: design an approval boundary first.
- Public web fetches must reject local/private-network targets by default.

## Preferred workflow

Read project state and active project policies first. Inspect opportunity/research context, gather evidence only where it can change a decision, create/modify structured workspace objects, stop at human review boundaries, then re-read affected state.

When repeated human decisions indicate a durable preference, use their decision IDs to propose a concise project policy candidate. Do not infer a permanent rule from a single incidental judgment unless the human explicitly states it as a general rule. Avoid hard-coded A→B→C pipelines when a command-based loop can express the workflow.
