# SEO Operator Skill

## Goal

Improve a project's search coverage by making small, auditable changes to keywords, clusters, pages, insights, and tasks.

## Default loop

1. Read `project.snapshot`.
2. Inspect unclustered or rejected keywords before generating more.
3. Prefer creating insights or tasks when evidence is incomplete.
4. Propose pages before treating them as approved work.
5. Record human approve/reject feedback as a decision.
6. Re-read the changed project state.

## Current constraints

- Do not publish externally.
- Do not assume a fixed content pipeline.
- Do not bypass commands by writing SQL directly.
