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
8. Research credentials are environment-only; never write access tokens, API keys, developer tokens, or OAuth secrets to SQLite, source metadata, runs, or decisions.
9. Publishing is intentionally not implemented yet. Do not add WordPress, Hatena, Blogger, or CMS credentials.

## Agent safety model

- Read operations: allowed without approval.
- Reversible workspace writes: allowed when requested.
- External research reads: allowed when configured, and should persist useful evidence as a `source`.
- Destructive or external side effects: design an approval boundary first.
- Public web fetches must reject local/private-network targets by default.

## Preferred workflow

Observe project state, inspect research context, gather evidence only where it can change a decision, create/modify structured workspace objects, record important judgments as decisions, then re-read the affected state. Avoid hard-coded A→B→C pipelines when a command-based loop can express the workflow.
