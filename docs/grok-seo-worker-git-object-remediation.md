# Groq SEO Worker: two supported transports (2026-10-15)

## Confirmed capability gap
Grok/Groq runner advertises `create_branch`, `push_files`, `get_commit`, `get_repository_tree`, `get_file_contents` but not `create_blob`, `create_tree`, `create_commit`. Repeated `preflight_git_objects_unavailable` reports do not mean source/Task refusal; they describe this connector mismatch only.

## Preferred path
Where low-level Git blob/tree/commit creation works, use `Action-Ref-Handoff: v1` with an unreferenced one-parent `[CF-Pages-Skip]` commit. The public `nomuonji/keywords` Action attaches `seo/<task-id>` and owns PR/main merge/completion.

## Groq-only branch fallback (now authorized for future eligible tasks)
Use only if low-level Git-object writers are missing AND `create_branch`, `push_files`, raw Git commit/tree/diff and source readback are callable within the Groq runner. No claim if neither transport works. Only for a fresh Task with active valid claim `actor=seo_worker`, no existing conflicting branch/PR, no cooldown and no historic refusal. User authorization to use a transport is **not** clearance to replay any specifically refused GitHub/Sites Operator write.

1. Verify Task exact site/repo, active registry, current default HEAD `B`, absent `seo/<task-id>`, acceptance and diff scope BEFORE claim. No `site_article_save` or bulk article registry writes.
2. Claim once; implement and validate. Call `create_branch` only for `seo/<task-id>` at `B`, then one `push_files` write to THAT branch with `[CF-Pages-Skip]` commit message. Do not force push, update an existing/other branch, write main, create PR or merge.
3. Read back branch HEAD `H`, commit and its **sole parent `B`**, tree and changed-file source, and compare `B...H`: one commit ahead, none behind, safe allowlisted paths only. Main must still be `B`. If any part cannot be verified, stop without falsely claiming handoff.
4. Persist `deliveryHandoff.state=push_pending`, exact task-bound branch, `baseSha=B`, `headSha=H`, summary starting with literal marker `Action-Branch-Handoff: v1` followed by ONE newline, actual validation receipts, and structured history `{actor: "seo_worker", event: "delivery_branch_push_pending", detail: "..."}`. Use active `claimRunId`; read the checkpoint back; stop.
5. Central Actions verifies rollout/registry/refusal history, branch SHA, one-parent commit, changed scope and current main, then records branch_ready, makes PR, verifies exact PR SHA/mergeability, merges and records completion. No peripheral GitHub Actions or GitHub site builds are involved; hosting builds after main push.

Corrective passes and existing quarantined Tasks require independent valid authorization; do not reuse this fallback to replay a refused action. Branch fallback is initial one-commit-from-main only; no force update for stale/failed branches.

## Failure categories
- Git capability absent: do not claim if both transports unavailable. Do not spam duplicate preflight histories.
- Git readback mismatch or main advances: stop; reconcile with current Task and main, never force update.
- Safety or authorization refusal: **stop the refused operation immediately**, record safely where permitted; switching transport is prohibited.
- Host build/publication pending after merge: implementation can be merged while `deploymentVerification` remains pending; Site Operator verifies exact deployed SHA/HTTP/canonical separately.

Repository Actions ownership applies to SEO delivery only. Do not change unrelated SNS posting, token refresh, content ingestion, product generation or other operational jobs in peripheral repositories.
