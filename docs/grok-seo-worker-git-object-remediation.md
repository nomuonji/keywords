# SEO Worker Git transport capabilities (historical Groq incident, 2026-10-15)

## Transport selection — capabilities, not model names

The repository originally documented a missing Git-object writer capability in one Groq connection. That incident remains historical context, **not a reason to lock the fallback to Groq**. Every authorized SEO Worker (ChatGPT, Groq or a future executor) must select a supported Git transport **before claiming a new Task**, using its *own currently callable tools*.

| Decision | Result |
| --- | --- |
| Low-level `create_blob`, `create_tree`, `create_commit` and commit/tree/blob readback all available | **A — prepared commit**: create unreferenced Git commit, read back source and SHA, write `Action-Ref-Handoff: v1` |
| Any A creation API **not exposed**, but `create_branch`, `push_files`, commit/tree/source/diff/ref readback all available | **B — verified branch**: create exact `seo/<task-id>` at main, push **one** `[CF-Pages-Skip]` commit, independently read back, write `Action-Branch-Handoff: v1` |
| Neither complete transport available | Do **not claim**; concise capability blocker, no repeated history spam |
| Any action explicitly safety/authorization refused | **Stop that operation**; never change transport to retry the refused content |

This is discovery **before claim**, not an automatic catch-and-retry mechanism after a failed `create_commit`. If tools were advertised but a write was denied, do not silently switch to B. Lack of an A tool in the actual runner is a capability gap, not itself an authorization refusal.

## Large structured data: avoid broken transport, not arbitrary extra gates

The Render Free and occupation-dataset attempts demonstrated that some `push_files` runners truncate long JSON argument content. For large complete-file replacements, an A-capable Worker uses `create_blob` -> `create_tree` -> `create_commit` with blob readback. The B fallback is still available for source patches that fit and can be read back exactly; do not use it for a payload size already known to fail in that runner.

If a previously claimed Worker cannot transmit the complete data, persist one `implementation_blocked` note with `deliveryHandoff.state=ci_failed` and release that Worker claim. Another Worker with an actually working A transport can take the Task without waiting for lease expiry. This is a capability-driven routing fix, not a new editorial approval or model-specific restriction.

## Shared hard constraints

- Verify the active site registry, exact Task ID, execution claim, no cooldown, latest main HEAD, task-bound branch `seo/<task-id>` and no prior safety/authorization rejection. Never resurrect the previously refused Book Discovery Task deliveries or the cancelled Task `21531a6b-6f80-4801-ae3a-6b4c671cc13d`.
- Scope must pass central changed-path allowlist. Never change `.github/workflows`, secrets, lockfiles, infrastructure or unrelated files through an SEO Worker. GitHub is content source of truth; Sites Operator article registry is read-only for Worker.
- Both transports require SHA/parent/tree/source readback and actual acceptance evidence. Commit subject begins `[CF-Pages-Skip]`; main may not advance before handoff. No force push, `update_ref`, direct main push, PR or merge from Workers.
- A saves `push_pending` with `Action-Ref-Handoff: v1\n`; B saves `push_pending` with `Action-Branch-Handoff: v1\n` and structured history `delivery_branch_push_pending` whose actor equals the active valid `executionClaim.actor` (supported values `seo_worker` and `chatgpt_seo_worker` for compatibility). This actor is an audit identifier, **not a model-specific transport selector**.
- The central public `nomuonji/keywords` Actions selects its verification path from the **handoff marker**, repeats Task/safety/one-parent/diff/ref checks, updates the ref only for A, verifies B's pre-existing task branch without rewriting it, then owns PR/merge and completion. Peripheral site Actions do not run SEO CI; hosting builds on main push and Site Operator verifies production separately.
- Do not change other SNS posting, content generation, token refresh, affiliate jobs, unrelated workflows or ChatGPT task schedules.

## End-to-end acceptance

On the next **new eligible** Task, confirm A or B tool discovery, claim once, implement and verify source, create its single Git commit, validate Git metadata and scope, persist the proper typed handoff, read back Task, then observe central Action → exact branch → PR → merge → completed. Since this is a functional change, an existing already-refused Task cannot be used as a test fixture. Passing central Actions CI alone does not prove this live end-to-end path.
