# Sites Operator SEO Worker Manual

> Status: **execution runbook**. This manual does not schedule a Worker, create GitHub Issues or grant new permissions. **For an authorized Worker, the expected result of a run is end-to-end delivery through main merge and applicable live verification—not a draft PR handoff.** The user has directed the Worker to merge validated changes; mandatory repository protections still apply.

Sites Operator is the canonical SEO task/control plane. GitHub is the source of truth for article/code changes and commit/PR evidence. New SEO tasks are saved directly as **`ready` records**; a GitHub Issue is never required. This manual describes the **execution** half of that arrangement, not planning or measurement collection.

**Authority order:** current `seo_agent_context(role=executor)` > the selected live `seo_task_get` record and its evidence > current target-repository code/accepted requirements > this runbook. If these conflict, follow the live policy and report the inconsistency. Do not silently broaden a task.

## 1. What the Worker may and may not do

| Responsibility | Source or boundary |
| --- | --- |
| Choose work | Check existing `in_progress` work for safe continuity first; otherwise `seo_task_list(status=ready)` and eligible legacy `issued` tasks. |
| Verify requirements | `seo_task_get(id)` (title, rationale, evidence, target URLs, task type, history, revision); read an optional legacy linked Issue only when present. |
| Verify scope and source | `site_registry_get(id=siteId)` and current default-branch GitHub repository, files, relevant PRs/commits and deployment evidence. |
| Track progress and evidence | `seo_task_update` with a **fresh** `expectedRevision`; read back via `seo_task_get`. |
| Implement and verify | Carry out the full material change, actual build/CI, PR ready/review, **main merge**, deployment and applicable live-route checks in the **same authorized run** where repository gates permit. |
| Off limits | No mandatory Issue creation, no direct GSC/GA4 acquisition, no use of My Portal/site-monitor as SEO control planes, no invented checks or delivery proof. |

**The execution infrastructure is separate from this manual.** An authorized Worker (e.g. a manually invoked coding agent) should execute the complete delivery lifecycle immediately, subject to real tests and mandatory review. This document does not claim that ChatGPT scheduled tasks have write permissions: those writes have previously failed safety checks, and any rejected action must not be rerouted.

## 2. Record lifecycle and legacy compatibility

| Status | Meaning for the Worker |
| --- | --- |
| `proposed` | Legacy pre-Issue backlog; the **Planner**, not the Worker, revalidates it to `ready` or `superseded`. |
| `ready` | The Planner has recorded an evidence-backed action in Sites Operator; implementation may be claimed after current-state validation. |
| `issued` | Legacy task with an existing Issue; treat as implementation-eligible after checking the live task and optional Issue. Do **not** open another Issue. |
| `in_progress` | An executor has claimed/started work. This does not prove a PR was opened, merged, deployed or verified. |
| `completed` | All applicable acceptance requirements have independent delivery evidence; record the main-branch result commit and concise verification details. |
| `superseded` | Task is invalid, duplicate, contradicted or already delivered; preserve the reason and source of proof. |
| `cancelled` | Intentionally abandoned; record the explicit decision and reason. |

There is **no `blocked` status**, no owner/lease field and no built-in automatic stale-claim reaper in the current API. Record temporary blockers as a history entry (for example `execution_blocked`); leave the status unchanged or `in_progress` if already claimed. Do not represent a timeout as authorization to steal someone else's work. Multiple Workers must coordinate ownership externally until an explicit lease/claim API exists.

## 3. Startup and selection

1. Call `seo_agent_context(role=executor)` **first on every run**. Use its current versioned policy and run contract. Re-read this manual from the canonical main branch if needed.
2. Inspect `in_progress` tasks **before** new selection. If this is the same Worker's continuing run, or the user explicitly confirms a previous run has ended and hands it off, prioritize finishing the existing PR/merge/live-verification work instead of opening another PR. Confirm current PR, task revision, and that no other executor is actively working before resuming. Otherwise list `ready` and eligible legacy `issued` tasks. Never automatically steal uncertain concurrent work or auto-promote `proposed` tasks.
3. Choose a genuine actionable task rather than manufacturing test work. Fetch its full record by ID. Inspect prior history, target URLs, repository, evidence, acceptance criteria if present and current `revision`.
4. Confirm the site is managed and active using `site_registry_get`. Inspect **current** repository default-branch HEAD, exact target files, metadata/canonicals, related PRs, merged commits and current production state when relevant. For legacy records, read the linked Issue as additional context, not as the task's identity.
5. Check whether the task is already implemented, actively owned, contradicted or stale. If already delivered, attach precise proof and use the appropriate historical reconciliation rather than repeating an edit. For a confirmed continuation/handoff of an `in_progress` task, reuse its existing PR and append `worker_resumed` with current revision/HEAD; otherwise avoid duplicate PRs or interfering with unknown active work.

### Claim the selected task

Claim with `seo_task_update` only after the read-only checks; transition `ready` or legacy `issued` to `in_progress` and append `worker_claimed` with the executor identity, observed GitHub HEAD and intended scope. Supply the **revision from the immediately preceding `seo_task_get`**. Read back the task, confirming status, incremented revision and history before editing.

Example shape (illustrative values; use real live IDs and revision):

```json
{
  "id": "<existing-task-id>",
  "expectedRevision": 3,
  "status": "in_progress",
  "appendHistory": {
    "actor": "seo_worker",
    "event": "worker_claimed",
    "detail": "Reviewed current main HEAD <sha>, prior changes, target URL and task evidence; starting only the documented intervention."
  }
}
```

If a revision conflict occurs, fetch the task again and reconcile; **do not blindly retry**. The API has no exclusive lease. Resume `in_progress` only for your own identifiable previous run or a confirmed explicit handoff after checking no other executor remains active; log `worker_resumed` and read back. Never silently preempt another Worker.

## 4. Make the smallest justified change

1. Reconfirm that the task's stated defect still exists on the actual current default branch. Do not use a past blob SHA as proof after main has moved.
2. Check whether an existing relevant branch/PR already has the fix. Reuse an authorized existing branch when appropriate, or use a task-specific branch such as `seo/<task-id-short>-<change>`. Do not modify main directly unless a separate approved workflow explicitly permits it.
3. Implement only the requested material scope. Preserve the intended existing URL, current SEO intent, internal links, metadata and affiliate links unless the task specifically justifies changing them. Verify factual claims using relevant primary sources. Do not introduce unverified product, legal or availability claims.
4. For `merge`/`delete`, identify the valid destination and preserve required redirects, canonicals and incoming internal links before deleting or merging URLs. For `technical`, reproduce the exact defect and confirm that the specified fix resolves it.
5. Run **real repository-specific validation** (install/build/typecheck/tests or the configured GitHub CI; preferably both when available), including generated routes and the particular acceptance assertions. Inspect the diff and confirm no unrelated files/secrets changed. **Do not claim build success without an actual run/result.** If no build-capable tool or usable CI exists, name the precise capability blocker and do not merge unvalidated content.
6. Create/update a PR referencing the **Sites Operator Task ID**, target URLs, changed files, main-base commit, rationale, evidence, acceptance criteria and real test/build results. A new GitHub Issue is never required. Prefer a normal ready-for-review PR when validations already passed; when a draft PR was created pending validation, **continue testing within this run and call `mark_pull_request_ready_for_review` as soon as the gates pass. Creating a draft PR is not a stopping point.**
7. **Merge in this run** when mandatory checks/review/branch rules are satisfied. Fetch current PR HEAD and base just before merge, check the exact commit checks and mergeability, and invoke `merge_pull_request` (with the expected HEAD SHA when available). Verify the merge result and main's actual target file; do not stop at reporting that someone should merge later. If merge is blocked, record the exact unmet gate and leave the same PR/task resumable.

If GitHub or Sites Operator writes are rejected by an OpenAI safety check, stop the rejected operation. Record the exact tool, stage and diagnostic in the run report and, **only if independently allowed**, append a failure history event to the task. Do not disguise, reword or reroute an equivalent denied operation. If no write succeeds, preserve the existing record and report the failure.

## 5. Mandatory end-to-end delivery and evidence gates

**Default: change → actual validation → ready PR → required review → merge to main → deploy → live verify → task `completed`.** Opening a draft PR and saying "the next safe step is build/merge" is **not** a successful authorized Worker run if the required tools and gates are available. Use the execution budget to attempt the remaining stages now, and report precise unmet gates only when genuinely blocked. No self-approval may substitute for a mandatory independent reviewer, and no test result may be fabricated.

Ordered merge procedure:

1. Identify the repository's actual build and checks; start/run them with authorized tools, then inspect check conclusions for the **current PR HEAD**. A pending, skipped or absent required check is not a pass. Resolve ordinary test failures within scope and rerun when permitted.
2. Review the full diff against Task acceptance criteria, current base and repository branch protections. When no external review is required, perform an independent factual/diff self-check without inventing a formal GitHub approval. If the repository explicitly requires another reviewer's approval, request it and preserve the exact blocker.
3. If the PR is a draft, **mark it ready for review** after validation; verify its new state. Refresh PR metadata, current HEAD SHA, mergeability, required checks, and required reviews. Merge only when all required gates pass and write permission allows it.
4. Execute the actual merge via the available GitHub merge operation. Read back GitHub's merged state and verified main-branch target code. Store the **main result commit SHA**; the feature-branch SHA is not proof of deployment.
5. Check the existing deployment integration and, when the task requires a live-site outcome, verify the exact production URL (including canonical/redirect, relevant content and cache/version where applicable). Record actual evidence. Do not claim a traffic lift before a valid observation period.

Use distinct evidence for the stages below. Do not conflate a branch commit, open PR, merged commit, build result and publicly deployed content.

| Stage | Evidence to record | Task state |
| --- | --- | --- |
| Implementation branch / PR | Branch name, PR URL if any, HEAD SHA, files changed, tested scope, known gaps. Store these in `executionSummary` and append `implementation_pr_opened` or equivalent history. | Keep `in_progress`. |
| CI / review | Actual build/check/run URLs and conclusions for the PR HEAD; ready-for-review state; mandatory approvals when configured (self-check alone otherwise). | Keep `in_progress` until gates pass, then **merge in this same run**. |
| Merged | Verify actual main-branch ancestry/merge commit, updated target file and acceptance criteria. Record the **main result SHA** (not merely PR head) in `resultCommitSha` when verified. | Keep `in_progress` if required production validation remains. |
| Production verified | Confirm the exact intended live route and substantive changes after deployment; distinguish cache or redirect anomalies from an actual live version. Record URL, observed checks and deployment commit. | Mark `completed` only when every applicable acceptance gate has been met. |

For tasks without a public URL or deployment requirement, `completed` can follow independent verification of all applicable repository/CI requirements. For site-content or live technical tasks, do not assert `live_verified` or mark completion on merge alone when the acceptance scope requires production verification. The pre-existing evaluation/cooldown workflow is separate from delivery; don't invent post-change analytics or claim traffic improvements on completion.

On every state change: `seo_task_get` -> `seo_task_update(id, expectedRevision, ...)` -> `seo_task_get` readback. Keep `executionSummary` concise but actionable. History is bounded; put stable URLs, identifiers and evidence in the summary, not just chat output. If deployment is delayed, **check deployment status and attempt live verification within the available run**, then leave `in_progress` with `merged_awaiting_live_verification` and the exact remaining checks only if still pending or blocked.

## 6. Supersession, failure and recovery

- **Already fixed / duplicate**: confirm current main and relevant task/PR evidence, then record `superseded` with a precise reason. Do not mark an untouched duplicate task as `completed` or create a placeholder change.
- **Unsafe or invalid requirements**: stop implementation, identify the exact conflicting requirement, append `execution_blocked` when allowed, and seek revision/authorization. Do not silently alter the mission.
- **Transient build/deployment failure**: inspect concrete logs, fix an in-scope error when authorized, rerun available checks, and continue toward merge/live verification in the same run. Only then preserve the true pending state and next retry condition.
- **Optimistic revision conflict**: read the latest record and independently reconcile updates; if another Worker owns the implementation, do not overwrite its evidence.
- **Safety/authorization refusal**: do not bypass the refusal via a proxy, different connector, API, GitHub Actions or another agent. Stop the rejected operation and report the exact diagnostic and unchanged task/PR state.

An incident report should include Task ID and revision, repository, initial and current HEAD, attempted action/tool, exact failure text, what writes (if any) actually succeeded, readback evidence, current task status and an explicit next safe step. **Never claim success from intent alone.**

## 7. Per-run report contract

Report selected Task ID and original status (or confirmed resumed handoff), current PR/actual changed files, **actual build/CI checks and their conclusions**, draft→ready transition where applicable, **actual merge invocation/result**, verified main SHA and production verification if required, final Sites Operator status/revision/readback, and exact unmet gates if genuinely blocked. Treat "PR created, merge later" as an incomplete execution outcome, not success, whenever the required gates and authorized tools were available.

### Minimal bootstrap for a future Worker

```text
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor); use its latest policy/run contract and the linked canonical Sites Operator Worker Manual. Inspect safe resumable in_progress deliveries first, then ready/legacy issued records; choose one real actionable task and verify its site, existing work and current HEAD. Claim/resume with fresh expectedRevision and readback. Implement the exact justified scope, run actual build/CI and review, mark a draft PR ready, **merge to main in this run as soon as required gates pass**, then verify deployment/live content when applicable. Record actual branch/PR, CI, main merge SHA and production evidence separately. Update Sites Operator with fresh revision and readback. No GitHub Issue is required; do not collect GSC/GA4 directly. Stop on safety refusals rather than rerouting. Never invent a merge, deployment or live verification.
```

**Related:** [Site Operations Architecture](./site-operations-architecture.md), [Analytics Bridge](./site-operations-analytics-bridge.md), [Site Operations Readiness](./site-operations-readiness.md). For current tool schemas, treat the live Sites Operator contract as authoritative.