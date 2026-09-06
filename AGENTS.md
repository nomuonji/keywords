# AGENTS.md

## Product principle

This repository is an agent-native SEO workspace. Do not add a second, agent-only state model. Human UI actions, CLI operations, and MCP tool calls must execute the same commands against the same SQL database.

## Boundaries

1. `packages/db` owns persistence and schema.
2. `packages/commands` owns mutations and business rules.
3. `apps/api`, `apps/cli`, `apps/mcp`, and `apps/web` are adapters.
4. Adapters must not write SQL directly.
5. Every mutating command must produce a `runs` audit record.
6. Human approve/reject choices that teach future behavior belong in `decisions`.
7. Publishing is intentionally not implemented yet. Do not add WordPress, Hatena, Blogger, or CMS credentials.

## Agent safety model

- Read operations: allowed without approval.
- Reversible workspace writes: allowed when requested.
- Destructive or external side effects: design an approval boundary first.

## Preferred workflow

Observe project state, create/modify structured workspace objects, record important judgments as decisions, then re-read the affected state. Avoid hard-coded A→B→C pipelines when a command-based loop can express the workflow.
